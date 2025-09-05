import express from 'express';
import { Agent, run } from '@openai/agents';
import z from 'zod';
import crypto from 'crypto';
import 'dotenv/config';
import { PRODUCT_MANAGER_SYSTEM_PROMPT, DEVELOPER_SYSTEM_PROMPT } from './sys.js';
import { createRepositoryTool, executeCommandTool, writeInFileTool, enablePagesTool, mainDirectoryCreationTool } from './developerTools.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const model = process.env.MODEL_TYPE || 'gpt-4o-mini';

const developerAgent = new Agent({
    name: 'developer',
    model,
    instructions: DEVELOPER_SYSTEM_PROMPT,
    tools: [executeCommandTool, writeInFileTool, createRepositoryTool, enablePagesTool, mainDirectoryCreationTool],
});

const managerAgent = new Agent({
    name: 'product_manager',
    instructions: PRODUCT_MANAGER_SYSTEM_PROMPT,
    model,
    outputType: z.object({
        is_followup_question: z.boolean(),
        question: z.string().nullish(),
        detailed_task_base_description: z.string().nullish()
    }),
});

// Object to store token -> previousResponseId mapping
const tokenSessions = {};

const generateToken = () => {
    return crypto.randomUUID();
};

const processQuery = async (userQuery, token) => {
    const previousResponseId = tokenSessions[token] || null;
    console.log(`[INFO] Processing user query: "${userQuery}"`);
    console.log(`[INFO] Using token: ${token}`);
    console.log(`[INFO] Using previous response ID: ${previousResponseId}`);

    try {
        console.log('[INFO] Running manager agent...');
        const response = await run(managerAgent, userQuery, { previousResponseId, maxTurns: 50 });
        tokenSessions[token] = response.lastResponseId;
        console.log(`[INFO] Manager agent completed. Response ID: ${response.lastResponseId}`);

        if (response.finalOutput.is_followup_question) {
            console.log('[INFO] Manager identified this as a follow-up question');
            return {
                type: 'question',
                content: response.finalOutput.question
            };
        } else {
            console.log('[INFO] Manager provided task description, running developer agent...');
            console.log('Task Description: ', response.finalOutput.detailed_task_base_description);

            const developerResponse = await run(developerAgent, response.finalOutput.detailed_task_base_description, { previousResponseId: tokenSessions[token], maxTurns: 50 });
            tokenSessions[token] = developerResponse.lastResponseId;
            console.log(`[INFO] Developer agent completed. Response ID: ${developerResponse.lastResponseId}`);
            
            return {
                type: 'task_completion',
                taskDescription: response.finalOutput.detailed_task_base_description,
                result: developerResponse.finalOutput
            };
        }
    } catch (error) {
        console.error(`[ERROR] Error in processQuery function: ${error.message}`);
        console.error(`[ERROR] Stack trace: ${error.stack}`);
        throw error;
    }
};

app.post('/chat', async (req, res) => {
    try {
        const { message, token } = req.body;
        
        if (!message) {
            return res.status(400).json({
                error: 'Message field is required'
            });
        }

        // Generate new token if not provided (first request)
        const sessionToken = token || generateToken();
        
        console.log(`[API] Received chat request with message: "${message}"`);
        console.log(`[API] Session token: ${sessionToken}`);
        
        const result = await processQuery(message, sessionToken);
        
        res.json({
            success: true,
            token: sessionToken,
            data: result
        });

    } catch (error) {
        console.error(`[API ERROR] Error processing chat request: ${error.message}`);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`[INFO] Server running on http://localhost:${port}`);
    console.log(`[INFO] Chat endpoint available at POST /chat`);
    console.log(`[INFO] Health check available at GET /health`);
});