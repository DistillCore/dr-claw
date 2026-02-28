import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { resolveCursorCliCommand } from '../utils/cursorCommand.js';

const router = express.Router();

router.get('/claude/status', async (req, res) => {
  try {
    const credentialsResult = await checkClaudeCredentials();

    if (credentialsResult.authenticated) {
      return res.json({
        authenticated: true,
        email: credentialsResult.email || 'Authenticated',
        method: 'cli'
      });
    }

    // Check for Custom API env var
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
      return res.json({
        authenticated: true,
        email: 'Custom API Connected',
        method: 'custom_api'
      });
    }

    return res.json({
      authenticated: false,
      email: null,
      error: credentialsResult.error || 'Not authenticated'
    });

  } catch (error) {
    console.error('Error checking Claude auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/cursor/status', async (req, res) => {
  try {
    const result = await checkCursorStatus();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error
    });

  } catch (error) {
    console.error('Error checking Cursor auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/codex/status', async (req, res) => {
  try {
    const result = await checkCodexCredentials();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error
    });

  } catch (error) {
    console.error('Error checking Codex auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

function checkClaudeCredentials() {
  return new Promise((resolve) => {
    let processCompleted = false;

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        // Fall back to credentials file check on timeout
        checkClaudeCredentialsFile().then(resolve);
      }
    }, 5000);

    let childProcess;
    try {
      childProcess = spawn('claude', ['auth', 'status', '--json'], {
        env: { ...process.env, CLAUDECODE: '' }
      });
    } catch {
      clearTimeout(timeout);
      checkClaudeCredentialsFile().then(resolve);
      return;
    }

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0 && stdout.trim()) {
        try {
          const status = JSON.parse(stdout.trim());
          if (status.loggedIn) {
            resolve({
              authenticated: true,
              email: status.email || null
            });
            return;
          }
        } catch {
          // JSON parse failed, fall through
        }
      }

      // CLI check failed, fall back to credentials file
      checkClaudeCredentialsFile().then(resolve);
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);
      // claude CLI not available, fall back to credentials file
      checkClaudeCredentialsFile().then(resolve);
    });
  });
}

async function checkClaudeCredentialsFile() {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null
        };
      }
    }

    return {
      authenticated: false,
      email: null
    };
  } catch (error) {
    return {
      authenticated: false,
      email: null
    };
  }
}

function checkCursorStatus() {
  return new Promise((resolve) => {
    let processCompleted = false;
    const cursorCommand = resolveCursorCliCommand();

    if (!cursorCommand) {
      resolve({
        authenticated: false,
        email: null,
        error: 'Cursor CLI not found. Install Cursor CLI or set CURSOR_CLI_PATH to `agent` or `cursor-agent`.'
      });
      return;
    }

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        resolve({
          authenticated: false,
          email: null,
          error: 'Command timeout'
        });
      }
    }, 5000);

    let childProcess;
    childProcess = spawn(cursorCommand, ['status']);

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0) {
        const emailMatch = stdout.match(/Logged in as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

        if (emailMatch) {
          resolve({
            authenticated: true,
            email: emailMatch[1],
            output: stdout
          });
        } else if (stdout.includes('Logged in')) {
          resolve({
            authenticated: true,
            email: 'Logged in',
            output: stdout
          });
        } else {
          resolve({
            authenticated: false,
            email: null,
            error: 'Not logged in'
          });
        }
      } else {
        resolve({
          authenticated: false,
          email: null,
          error: stderr || 'Not logged in'
        });
      }
    });

    childProcess.on('error', (err) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      resolve({
        authenticated: false,
        email: null,
        error: `${cursorCommand} is not available`
      });
    });
  });
}

async function checkCodexCredentials() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          // If JWT decoding fails, use fallback
          email = 'Authenticated';
        }
      }

      return {
        authenticated: true,
        email
      };
    }

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth'
      };
    }

    return {
      authenticated: false,
      email: null,
      error: 'No valid tokens found'
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Codex not configured'
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error.message
    };
  }
}

router.post('/claude/verify-custom-api', async (req, res) => {
  try {
    const { baseUrl, token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const verifyUrl = `${baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': token,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
    });

    // 200 = success, 401/403 = bad token, anything else with a valid JSON body means the endpoint is reachable
    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403)) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch (e) { /* ignore if not exists */ }

      const keysToUpdate = {
        'ANTHROPIC_BASE_URL': baseUrl || 'https://api.anthropic.com',
        'ANTHROPIC_AUTH_TOKEN': token,
        'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS': '1'
      };

      const newLines = [];
      const existingKeys = new Set();
      envContent.split('\n').forEach(line => {
        const [key] = line.split('=');
        if (keysToUpdate[key.trim()]) {
          newLines.push(`${key.trim()}=${keysToUpdate[key.trim()]}`);
          existingKeys.add(key.trim());
        } else if (line.trim()) {
          newLines.push(line);
        }
      });

      Object.entries(keysToUpdate).forEach(([key, val]) => {
        if (!existingKeys.has(key)) {
          newLines.push(`${key}=${val}`);
        }
      });

      await fs.writeFile(envPath, newLines.join('\n') + '\n');

      Object.entries(keysToUpdate).forEach(([key, val]) => {
        process.env[key] = val;
      });

      return res.json({ success: true, message: 'Custom API verified and applied.' });
    } else {
      const err = await response.text();
      return res.status(response.status).json({ error: `Verification failed: ${err}` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
