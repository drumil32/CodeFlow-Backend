import { tool } from "@openai/agents";
import z from "zod";
import { exec, spawn } from "child_process";
import { writeFileSync, existsSync } from "fs";
import axios from "axios";
let mainRepoName;
const executeCommandSchema = z.object({
    command: z.string().nonempty('Please provide a nonempty string')
});
const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
const spawnedShell = spawn(gitBashPath);
spawnedShell.on('error', (err) => {
    console.error('Failed to start Git Bash:', err);
    console.error('Make sure Git Bash is installed and the path is correct');
    process.exit(1);
});

const executeCommand = async ({ command }) => {
    console.log(`[INFO] Executing command: "${command}"`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
        let outputBuffer = '';
        let errorBuffer = '';
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                const executionTime = Date.now() - startTime;
                console.error(`[ERROR] Command execution timed out after ${executionTime}ms: "${command}"`);
                reject({
                    success: false,
                    error: 'Command execution timed out',
                    executionTime,
                    partialOutput: outputBuffer
                });
            }
        }, 30000);

        const stdoutHandler = (data) => {
            const output = data.toString();
            outputBuffer += output;
            console.log(`[DEBUG] stdout chunk: ${output.trim()}`);
            
            // Check for command completion markers
            if ((output.includes('COMMAND_SUCCESS') || output.includes('COMMAND_FAILED')) && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                const executionTime = Date.now() - startTime;
                
                spawnedShell.stdout.removeListener('data', stdoutHandler);
                spawnedShell.stderr.removeListener('data', stderrHandler);
                
                const isSuccess = output.includes('COMMAND_SUCCESS');
                const cleanOutput = outputBuffer.replace(/COMMAND_(SUCCESS|FAILED)/g, '').trim();
                
                if (isSuccess) {
                    console.log(`[INFO] Command executed successfully in ${executionTime}ms: "${command}"`);
                } else {
                    console.error(`[ERROR] Command failed in ${executionTime}ms: "${command}"`);
                }
                
                if (cleanOutput) {
                    console.log(`[INFO] stdout: ${cleanOutput}`);
                }
                if (errorBuffer.trim()) {
                    console.warn(`[WARN] stderr: ${errorBuffer.trim()}`);
                }
                
                resolve({
                    success: isSuccess,
                    stdout: cleanOutput,
                    stderr: errorBuffer.trim() || null,
                    executionTime,
                    commandStatus: isSuccess ? 'success' : 'failed'
                });
            }
        };

        const stderrHandler = (data) => {
            const error = data.toString();
            errorBuffer += error;
            console.error(`[DEBUG] stderr chunk: ${error.trim()}`);
        };

        spawnedShell.stdout.on('data', stdoutHandler);
        spawnedShell.stderr.on('data', stderrHandler);

        try {
            const commandWithStatus = `${command} && echo "COMMAND_SUCCESS" || echo "COMMAND_FAILED"`;
            spawnedShell.stdin.write(`${commandWithStatus}\n`);
            console.log(`[DEBUG] Command sent to shell: "${commandWithStatus}"`);
        } catch (writeError) {
            resolved = true;
            clearTimeout(timeout);
            const executionTime = Date.now() - startTime;
            console.error(`[ERROR] Failed to write command to shell after ${executionTime}ms: ${writeError.message}`);
            
            spawnedShell.stdout.removeListener('data', stdoutHandler);
            spawnedShell.stderr.removeListener('data', stderrHandler);
            
            reject({
                success: false,
                error: `Failed to write command to shell: ${writeError.message}`,
                executionTime
            });
        }
    });
}

export const executeCommandTool = tool({
    name: "execute_command",
    description: 'If you want to run any commands related to win11 system like then you can use this tool',
    parameters: executeCommandSchema,
    execute: executeCommand
});

export const mainDirectoryCreationTool = tool({
    name: "create_main_directory",
    description: "If you want to create a main directory for your project then you can use this tool, just provide the name of the directory",
    parameters: z.object({
        dirName: z.string()
    }),
    execute: async ({ dirName }) => {
        mainRepoName = dirName;
        console.log(`[INFO] Creating main directory: "${dirName}"`);
        return await executeCommand({ command: `mkdir ${dirName}` });
    }
});


const writeInFile = ({ filePath, data }) => {
    console.log(`[INFO] Preparing to write to file: "${filePath}"`);
    filePath = `${mainRepoName}/${filePath}`;
    console.log(`[INFO] Updated file path: "${filePath}"`);
    console.log(`[INFO] Checking if file exists: "${filePath}"`);
    
    if (!existsSync(filePath)) {
        console.error(`[ERROR] File does not exist: "${filePath}"`);
        throw new Error(`File "${filePath}" does not exist. Cannot write to non-existing file.`);
    }

    console.log(`[INFO] File exists, proceeding to write: "${filePath}"`);
    console.log(`[INFO] Data length: ${data.length} characters`);

    try {
        writeFileSync(filePath, data);
        console.log(`[INFO] Successfully wrote to file: "${filePath}"`);
        return `File "${filePath}" written successfully`;
    } catch (error) {
        console.error(`[ERROR] Failed to write to file "${filePath}": ${error.message}`);
        console.error(`[ERROR] Stack trace: ${error.stack}`);
        throw error;
    }
};

export const writeInFileTool = tool({
    name: "write_in_file",
    description: "if you want to write inside a file then you can use this tool, first argument is file path this will be relative path which you can give and 2nd argument is data which you want to write",
    parameters: z.object({ filePath: z.string(), data: z.string() }),
    execute: writeInFile
});

const token = process.env.GITHUB_TOKEN;

const createRepository = async (request) => {
    // Validate input using zod schema
    // const validatedRequest = CreateRepoRequestSchema.parse(request);

    console.log('Creating GitHub repository')
    console.log({
        repoName: request.name,
        description: request.description,
        private: request.private,
    });

    try {
        const response = await axios.post('https://api.github.com/user/repos', {
            name: request.name,
            description: request.description || '',
            private: request.private || false,
            auto_init: request.autoInit,
        }, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
            }
        });

        // Validate response using zod schema
        const repo = response.data;
        // const repo = GitHubRepositorySchema.parse(response.data);

        console.log('GitHub repository created successfully')
        console.log({
            repoName: repo.name,
            repoUrl: repo.html_url,
            cloneUrl: repo.clone_url,
            defaultBranch: repo.default_branch,
            requestId: request.requestId
        });

        return repo;
    } catch (error) {
        const axiosError = error;

        console.log('Failed to create GitHub repository')
        console.log({
            error: axiosError.response?.data || axiosError.message,
            status: axiosError.response?.status,
            repoName: request.name,
            requestId: request.requestId
        });

        if (axiosError.response?.status === 422) {
            throw new Error(`Repository "${request.name}" already exists`);
        } else if (axiosError.response?.status === 401) {
            throw new Error('Invalid GitHub token');
        } else {
            throw new Error(`GitHub API Error: ${axiosError.response?.data || axiosError.message}`);
        }
    }
}

export const CreateRepoRequestSchema = z.object({
    name: z.string().min(1, 'Repository name is required'),
    description: z.string().nullish(),
    private: z.boolean().nullish().default(false),
    autoInit: z.boolean().nullish().default(false),
});
export const createRepositoryTool = tool({
    name: 'create_repository',
    description: 'Create a new GitHub repository. This should only be called once per conversation.',
    parameters: CreateRepoRequestSchema,
    execute: createRepository
});

const enableGitHubPages = async (request) => {
    console.log(`[INFO] Enabling GitHub Pages for repository: "${request.repo}"`);
    console.log(`[INFO] Request parameters:`, {
        repo: request.repo,
        branch: request.branch || 'main',
        path: request.path || '/',
    });

    try {
        // Validate input using zod schema
        const validatedRequest = EnablePagesRequestSchema.parse(request);
        validatedRequest.owner = process.env.GITHUB_OWNER || 'drumil32';

        console.log(`[INFO] Making API request to enable GitHub Pages...`);
        const response = await axios.post(
            `https://api.github.com/repos/${validatedRequest.owner}/${validatedRequest.repo}/pages`,
            {
                source: {
                    branch: validatedRequest.branch || 'main',
                    path: validatedRequest.path || '/'
                }
            },
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const pages = response.data;
        console.log(`[INFO] GitHub Pages enabled successfully for "${validatedRequest.repo}"`);
        console.log(`[INFO] Pages URL: ${pages.html_url}`);
        console.log(`[INFO] Status: ${pages.status}`);

        console.log(`[INFO] Monitoring GitHub Pages build status...`);
        await githubPageStatus(validatedRequest.repo);
        console.log(`[INFO] GitHub Pages setup completed successfully`);

        return pages;
    } catch (error) {
        const axiosError = error;

        console.error(`[ERROR] Failed to enable GitHub Pages for "${request.repo}"`);
        console.error(`[ERROR] Status code: ${axiosError.response?.status}`);
        console.error(`[ERROR] Error message: ${axiosError.response?.data || axiosError.message}`);
        console.error(`[ERROR] Stack trace: ${axiosError.stack}`);

        if (axiosError.response?.status === 404) {
            throw new Error(`Repository "drumil32/${request.repo}" not found`);
        } else if (axiosError.response?.status === 409) {
            throw new Error('GitHub Pages already enabled for this repository');
        } else if (axiosError.response?.status === 401) {
            throw new Error('Invalid GitHub token');
        } else {
            throw new Error(`GitHub API Error: ${axiosError.response?.data || axiosError.message}`);
        }
    }
}

const owner = process.env.GITHUB_OWNER || 'drumil32';
const githubPageStatus = async (repo) => {
    console.log(`[INFO] Starting GitHub Pages build status monitoring for repository: "${repo}"`);
    console.log(`[INFO] Checking build status every 2 seconds...`);

    return new Promise((res, rej) => {
        const startTime = Date.now();
        const intervalId = setInterval(
            async () => {
                try {
                    const response = await axios.get(
                        `https://api.github.com/repos/${owner}/${repo}/pages/builds/latest`,
                        {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'Authorization': `token ${token}`,
                            }
                        }
                    );

                    const buildData = response.data;
                    const elapsedTime = Math.round((Date.now() - startTime) / 1000);

                    console.log(`[INFO] Build status check (${elapsedTime}s): ${buildData.status}`);

                    if (buildData.status === 'built') {
                        clearInterval(intervalId);
                        console.log(`[INFO] GitHub Pages build completed successfully after ${elapsedTime}s`);
                        console.log(`[INFO] Repository "${repo}" is now live`);
                        return res({ message: 'GitHub Pages is up and running', success: true });
                    } else if (buildData.status === 'errored') {
                        clearInterval(intervalId);
                        console.error(`[ERROR] GitHub Pages build failed after ${elapsedTime}s`);
                        console.error(`[ERROR] Build error for repository "${repo}"`);
                        return rej({ message: 'GitHub Pages build failed. Please check status manually.', success: false });
                    }
                } catch (error) {
                    clearInterval(intervalId);
                    console.error(`[ERROR] Failed to check GitHub Pages build status: ${error.message}`);
                    console.error(`[ERROR] Stack trace: ${error.stack}`);
                    return rej({ message: 'Failed to monitor GitHub Pages build status', success: false });
                }
            }, 2000);
    });
}

const EnablePagesRequestSchema = z.object({
    repo: z.string().min(1, 'Repository name is required'),
    branch: z.string().nullish().default('main'),
    path: z.string().nullish().default('/'),
});

export const enablePagesTool = tool({
    name: 'enable_gitHub_pages',
    description: 'Enable GitHub Pages for a repository',
    parameters: EnablePagesRequestSchema,
    execute: enableGitHubPages
});







