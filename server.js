// File: server.js
const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file');
  process.exit(1);
}

// Initialize Express app
const app = express();
app.use(express.json());
// Replace the simple cors() with a more restrictive configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.com', 'https://www.your-company.com'] 
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, 'public')));

// Create a rate limiter (adjust limits as needed)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply to all requests to the chat endpoint
app.use('/api/chat', apiLimiter);

// For production environments, add additional security checks
if (process.env.NODE_ENV === 'production') {
  // Ensure the API key is properly formatted (basic validation)
  if (!process.env.GEMINI_API_KEY.match(/^[A-Za-z0-9_-]+$/)) {
    console.error('GEMINI_API_KEY appears to be malformed');
    process.exit(1);
  }
  
  console.log('Running in production mode with valid API key configuration');
}

// Initialize API configuration
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file');
  process.exit(1);
}

// Define system instructions (your PipelineExpert prompt)
const systemInstruction = `
<role>
You are PipelineExpert, a specialized AI recommendation system for pipeline products. Your purpose is to recommend the optimal pipeline products based on customer requirements and provide reasoning for your choices.
</role>

<goal>
Match customer requirements for pipeline systems with the most suitable products from our catalog, providing clear technical justifications and delivering recommendations in both human-readable format and structured JSON for direct cart integration.
</goal>

<context>
- Each pipe product is sold by the meter (1 pipeline = 1 meter)
- Customers need guidance on both primary piping and necessary accessories like seals
- Technical specifications (pressure, temperature, diameter) must be matched precisely
</context>

<format_rules>
- Begin with a concise 2-3 sentence summary of your recommendation
- Structure your response with clear sections: Recommendation, Technical Justification, Complete Solution
- Use simple language while maintaining technical accuracy
- Always end with a properly formatted JSON object for cart integration
</format_rules>

<response_structure>
1. Brief recommendation summary
2. Primary product recommendation with technical justification
3. Additional necessary components (seals, fittings)
4. JSON output for cart integration
</response_structure>
`;

// API endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    console.log('Received chat request:', req.body.message);
    const { message, history = [] } = req.body;
    
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
    
    // Send back the AI response
    res.json({ 
      response: aiResponse,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error calling Google AI API:', error.message);
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('API Response Error:', error.response.data);
      console.error('Status:', error.response.status);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
    }
    
    res.status(500).json({ 
      error: 'Failed to get response from AI',
      message: error.message 
    });
  }
});

// Test endpoint to verify API connection
app.get('/api/test', async (req, res) => {
  try {
    const testPayload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Tell me about pipeline products" }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          { text: systemInstruction }
        ]
      }
    };
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      testPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json({ 
      success: true, 
      response: response.data.candidates[0].content.parts[0].text 
    });
  } catch (error) {
    console.error('Test API call failed:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response ? error.response.data : 'No response details' 
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});