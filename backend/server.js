require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Supabase setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Mock users
const users = {
  netrunnerX: { id: 'user1', role: 'admin' },
  reliefAdmin: { id: 'user2', role: 'contributor' }
};

// WebSocket broadcast
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});

const broadcast = (event, data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data }));
    }
  });
};

// Cache helper
async function getCached(key, fetchFn, ttl = 3600) {
  const { data } = await supabase
    .from('cache')
    .select('value, expires_at')
    .eq('key', key)
    .single();

  if (data && new Date(data.expires_at) > new Date()) {
    return data.value;
  }

  const value = await fetchFn();
  await supabase
    .from('cache')
    .upsert({ key, value, expires_at: new Date(Date.now() + ttl * 1000) });
  return value;
}

// Mock Gemini API
async function extractLocation(description) {
  return { location: 'Manhattan, NYC' }; // Mocked
}

async function verifyImage(imageUrl) {
  return { status: 'authentic', confidence: 0.95 }; // Mocked
}

// Nominatim Geocoding
async function geocode(locationName) {
  const cacheKey = `geocode:${locationName}`;
  return getCached(cacheKey, async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=1`;
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': 'DisasterResponsePlatform/1.0 (akhilraparthy@gmail.com)' }
      });
      if (!data || data.length === 0) throw new Error('No geocoding results');
      const { lat, lon } = data[0];
      return { lat: parseFloat(lat), lon: parseFloat(lon) };
    } catch (error) {
      console.error(`Geocoding error: ${error.message}`);
      throw error;
    }
  });
}

// Disaster CRUD
app.post('/disasters', async (req, res) => {
  const { title, description, tags } = req.body;
  const userId = users.netrunnerX.id;
  try {
    const locationName = await extractLocation(description);
    const { lat, lon } = await geocode(locationName);
    const { data, error } = await supabase
      .from('disasters')
      .insert({
        id: uuidv4(),
        title,
        location_name: locationName,
        location: `SRID=4326;POINT(${lon} ${lat})`,
        description,
        tags,
        owner_id: userId,
        audit_trail: [{ action: 'create', user_id: userId, timestamp: new Date().toISOString() }]
      })
      .select()
      .single();
    if (error) throw error;
    broadcast('disaster_updated', data);
    console.log(`Disaster created: ${title} at ${locationName}`);
    res.json(data);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/disasters', async (req, res) => {
  const { tag } = req.query;
  let query = supabase.from('disasters').select('*');
  if (tag) query = query.contains('tags', [tag]);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/disasters/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, tags } = req.body;
  const userId = users.netrunnerX.id;
  try {
    const { data, error } = await supabase
      .from('disasters')
      .update({
        title,
        description,
        tags,
        audit_trail: supabase.raw(`audit_trail || '[{"action":"update","user_id":"${userId}","timestamp":"${new Date().toISOString()}"}]'::jsonb`)
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    broadcast('disaster_updated', data);
    console.log(`Disaster updated: ${id}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/disasters/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('disasters').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  broadcast('disaster_updated', { id });
  console.log(`Disaster deleted: ${id}`);
  res.status(204).send();
});

// Social Media Mock
app.get('/disasters/:id/social-media', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `social:${id}`;
  const data = await getCached(cacheKey, () => ({
    posts: [{ post: '#floodrelief Need food in NYC', user: 'citizen1' }]
  }));
  broadcast('social_media_updated', data);
  console.log(`Social media fetched for disaster: ${id}`);
  res.json(data);
});

// Geospatial Resources
app.get('/disasters/:id/resources', async (req, res) => {
  const { id } = req.params;
  const { lat, lon } = req.query;
  try {
    const { data, error } = await supabase
      .from('resources')
      .select('*')
      .eq('disaster_id', id)
      .filter('location', 'st_dwithin', `SRID=4326;POINT(${lon} ${lat}), 10000`);
    if (error) throw error;
    broadcast('resources_updated', data);
    console.log(`Resources fetched for disaster: ${id}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Official Updates
app.get('/disasters/:id/official-updates', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `updates:${id}`;
  try {
    const data = await getCached(cacheKey, async () => {
      const { data: html } = await axios.get('https://www.fema.gov');
      const $ = cheerio.load(html);
      return { updates: $('article').map((i, el) => $(el).text().slice(0, 100)).get() };
    });
    console.log(`Official updates fetched for disaster: ${id}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Image Verification
app.post('/disasters/:id/verify-image', async (req, res) => {
  const { image_url } = req.body;
  try {
    const result = await verifyImage(image_url);
    const { error } = await supabase
      .from('reports')
      .update({ verification_status: result.status })
      .eq('image_url', image_url);
    if (error) throw error;
    console.log(`Image verified: ${image_url}`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Geocoding Endpoint
app.post('/geocode', async (req, res) => {
  const { description } = req.body;
  try {
    const locationName = await extractLocation(description);
    const coords = await geocode(locationName);
    console.log(`Geocoded: ${locationName}`);
    res.json({ locationName, ...coords });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(3001, () => console.log('Server running on port 3001'));