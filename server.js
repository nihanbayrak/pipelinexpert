// File: server.js
const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize API configuration
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials are not set in .env file');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Define system instructions for PipelineExpert
const systemInstruction = `
<role>
You are PipelineExpert, a specialized AI recommendation system for pipeline products. Your purpose is to recommend the optimal pipeline products based on customer requirements and provide reasoning for your choices.
</role>

<goal>
Match customer requirements for pipeline systems with the most suitable products from our catalog, providing clear technical justifications and delivering recommendations in a human-readable format.
</goal>

<context>
- Each pipe product is sold by the meter (1 pipeline = 1 meter)
- Customers need guidance on both primary piping and necessary accessories like seals
- Technical specifications (pressure, temperature, diameter) must be matched precisely
- You must ONLY recommend products that appear in the product catalog provided
- If a specific requirement cannot be met with catalog products, clearly state this limitation
</context>

<format_rules>
- Begin with a concise 2-3 sentence summary of your recommendation
- Structure your response with clear sections: Recommendation, Technical Justification, Complete Solution
- Use simple language while maintaining technical accuracy
- Clearly list required products with their exact names and quantities
- Never invent products - use ONLY items that exist in the provided catalog
</format_rules>

<response_structure>
1. Brief recommendation summary
2. Primary product recommendation with technical justification
3. Additional necessary components (seals, fittings)
4. Complete shopping list with products and quantities
</response_structure>

<product_catalog>
... [YOUR PRODUCT CATALOG JSON HERE] ...
</product_catalog>
`;

// USER MANAGEMENT ENDPOINTS

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Query the database for the user
    const { data, error } = await supabase
      .from('client_users')
      .select('*')
      .eq('username', username)
      .eq('password', password) // Note: In production, use proper password hashing
      .single();
    
    if (error || !data) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Return user info (excluding password)
    res.json({
      id: data.id,
      username: data.username,
      displayName: data.display_name
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('client_users')
      .select('id, username, display_name, created_at')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Add a new user
app.post('/api/users', async (req, res) => {
  try {
    const { username, displayName, password } = req.body;
    
    if (!username || !displayName || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Check if username already exists
    const { data: existingUser } = await supabase
      .from('client_users')
      .select('id')
      .eq('username', username)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Insert the new user
    const { data, error } = await supabase
      .from('client_users')
      .insert([
        { 
          username: username,
          display_name: displayName,
          password: password // In production, hash this password
        }
      ])
      .select()
      .single();
    
    if (error) throw error;
    
    res.status(201).json({
      id: data.id,
      username: data.username,
      displayName: data.display_name
    });
  } catch (error) {
    console.error('Error adding user:', error);
    res.status(500).json({ error: 'Failed to add user' });
  }
});

// Delete a user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('client_users')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// CHAT ENDPOINTS

// API endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    console.log('Received chat request:', req.body.message);
    const { message, history = [], sessionId, userId } = req.body;
    
    // Validate user ID
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Create a unique session ID if not provided
    const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store user message in database
    await supabase
      .from('chat_messages')
      .insert([
        { 
          session_id: currentSessionId, 
          content: message, 
          is_user: true,
          user_id: userId
        }
      ]);
    
    // Create request payload
    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: message }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          { text: systemInstruction }
        ]
      },
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1000,
      }
    };
    
    // If there's conversation history, add it to the payload
    if (history.length > 0) {
      // Format history for Gemini API
      const formattedHistory = history.map(msg => ({
        role: msg.isUser ? "user" : "model",
        parts: [{ text: msg.content }]
      }));
      
      // Add history before the current message
      payload.contents = [...formattedHistory, payload.contents[0]];
    }
    
    console.log('Sending request to Gemini API...');
    
    // Make direct API call using axios
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Received response from Gemini API');
    
    // Extract the text response from the API response
    const aiResponse = response.data.candidates[0].content.parts[0].text;
    const timestamp = new Date().toISOString();
    
    // Store AI response in database
    await supabase
      .from('chat_messages')
      .insert([
        { 
          session_id: currentSessionId, 
          content: aiResponse, 
          is_user: false,
          timestamp: timestamp,
          user_id: userId
        }
      ]);
    
    // Send back the AI response
    res.json({ 
      response: aiResponse,
      timestamp: timestamp,
      sessionId: currentSessionId
    });
  } catch (error) {
    console.error('Error calling API:', error.message);
    
    if (error.response) {
      console.error('API Response Error:', error.response.data);
      console.error('Status:', error.response.status);
    } else if (error.request) {
      console.error('No response received:', error.request);
    }
    
    res.status(500).json({ 
      error: 'Failed to get response from AI',
      message: error.message 
    });
  }
});

// Get chat sessions for admin
app.get('/api/sessions-admin', async (req, res) => {
  try {
    // Get all sessions with user info joined
    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        session_id,
        created_at,
        user_id,
        client_users:user_id (
          username,
          display_name
        )
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Process to get unique sessions with user info
    const sessionsMap = new Map();
    
    data.forEach(item => {
      if (!sessionsMap.has(item.session_id)) {
        sessionsMap.set(item.session_id, {
          session_id: item.session_id,
          created_at: item.created_at,
          user_id: item.user_id,
          username: item.client_users ? item.client_users.username : null,
          display_name: item.client_users ? item.client_users.display_name : null
        });
      }
    });
    
    const uniqueSessions = Array.from(sessionsMap.values());
    res.json(uniqueSessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Get messages for a specific session
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get chat sessions for a specific user
app.get('/api/user-sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get sessions for this specific user
    const { data, error } = await supabase
      .from('chat_messages')
      .select('session_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Process to get unique sessions
    const sessionsMap = new Map();
    
    data.forEach(item => {
      if (!sessionsMap.has(item.session_id)) {
        sessionsMap.set(item.session_id, {
          session_id: item.session_id,
          created_at: item.created_at
        });
      }
    });
    
    const uniqueSessions = Array.from(sessionsMap.values());
    res.json(uniqueSessions);
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Test endpoint
app.get('/api/test', async (req, res) => {
  try {
    res.json({ success: true, message: 'API is working' });
  } catch (error) {
    console.error('Test API call failed:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});