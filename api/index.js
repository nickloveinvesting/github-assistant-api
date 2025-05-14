const express = require('express');
const { Octokit } = require('@octokit/rest');
const cors = require('cors');
const app = express();
const serverless = require('serverless-http');

// Environment variables will be set in Vercel
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const API_KEY = process.env.API_KEY;

// Initialize Octokit (GitHub API client)
const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

app.use(cors());
app.use(express.json());

// Middleware to check API key
const checkApiKey = (req, res, next) => {
  const providedKey = req.headers['x-api-key'];
  
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }
  
  next();
};

// Root endpoint
app.get('/api', (req, res) => {
  res.json({ message: 'GitHub Assistant API is running!' });
});

// List files endpoint
app.get('/api/list', checkApiKey, async (req, res) => {
  try {
    const path = req.query.path || '';
    
    const response = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: path
    });
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file endpoint
app.post('/api/delete', checkApiKey, async (req, res) => {
  try {
    const { path } = req.body;
    
    if (!path) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    // First, get the file to get its SHA
    let fileData;
    try {
      const response = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: path
      });
      fileData = response.data;
    } catch (error) {
      return res.status(404).json({ error: `File not found: ${error.message}` });
    }
    
    // Handle directory vs file
    if (Array.isArray(fileData)) {
      // It's a directory, delete each file
      const results = [];
      
      for (const item of fileData) {
        if (item.type === 'file') {
          try {
            await octokit.repos.deleteFile({
              owner: REPO_OWNER,
              repo: REPO_NAME,
              path: item.path,
              message: `Delete ${item.path}`,
              sha: item.sha
            });
            
            results.push({ success: true, path: item.path });
          } catch (error) {
            results.push({ error: error.message, path: item.path });
          }
        }
      }
      
      return res.json({ success: true, results, message: `Processed directory ${path}` });
    } else {
      // It's a single file
      await octokit.repos.deleteFile({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: path,
        message: `Delete ${path}`,
        sha: fileData.sha
      });
      
      return res.json({ success: true, message: `Deleted file ${path}` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update file endpoint
app.post('/api/create', checkApiKey, async (req, res) => {
  try {
    const { path, content, message } = req.body;
    
    if (!path || !content) {
      return res.status(400).json({ error: 'Path and content are required' });
    }
    
    // Check if file exists to get its SHA
    let sha;
    try {
      const response = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: path
      });
      
      sha = response.data.sha;
    } catch (error) {
      // File doesn't exist, which is fine for creation
    }
    
    // Create or update the file
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: path,
      message: message || `Update ${path}`,
      content: Buffer.from(content).toString('base64'),
      sha: sha
    });
    
    res.json({ success: true, message: `Updated ${path}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Claude-specific endpoint that combines all functionality
app.post('/api/claude', checkApiKey, async (req, res) => {
  try {
    const { action, path, content, message } = req.body;
    
    if (action === 'list') {
      const response = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: path || ''
      });
      
      return res.json(response.data);
    }
    else if (action === 'delete') {
      if (!path) {
        return res.status(400).json({ error: 'Path is required' });
      }
      
      // First, get the file to get its SHA
      let fileData;
      try {
        const response = await octokit.repos.getContent({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          path: path
        });
        fileData = response.data;
      } catch (error) {
        return res.status(404).json({ error: `File not found: ${error.message}` });
      }
      
      // Handle directory vs file
      if (Array.isArray(fileData)) {
        // It's a directory, delete each file
        const results = [];
        
        for (const item of fileData) {
          if (item.type === 'file') {
            try {
              await octokit.repos.deleteFile({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: item.path,
                message: `Delete ${item.path}`,
                sha: item.sha
              });
              
              results.push({ success: true, path: item.path });
            } catch (error) {
              results.push({ error: error.message, path: item.path });
            }
          }
        }
        
        return res.json({ success: true, results, message: `Processed directory ${path}` });
      } else {
        // It's a single file
        await octokit.repos.deleteFile({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          path: path,
          message: `Delete ${path}`,
          sha: fileData.sha
        });
        
        return res.json({ success: true, message: `Deleted file ${path}` });
      }
    }
    else if (action === 'create') {
      if (!path || !content) {
        return res.status(400).json({ error: 'Path and content are required' });
      }
      
      // Check if file exists to get its SHA
      let sha;
      try {
        const response = await octokit.repos.getContent({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          path: path
        });
        
        sha = response.data.sha;
      } catch (error) {
        // File doesn't exist, which is fine for creation
      }
      
      // Create or update the file
      const response = await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: path,
        message: message || `Update ${path}`,
        content: Buffer.from(content).toString('base64'),
        sha: sha
      });
      
      return res.json({ success: true, message: `Updated ${path}` });
    }
    else {
      return res.status(400).json({ error: "Invalid action. Use 'list', 'delete', or 'create'" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for serverless
module.exports = app;
module.exports.handler = serverless(app);
