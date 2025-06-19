import React, { useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:3001');

function App() {
  const [disasters, setDisasters] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', tags: '' });
  const [report, setReport] = useState({ content: '', image_url: '' });

  useEffect(() => {
    fetchDisasters();
    socket.on('disaster_updated', () => fetchDisasters());
    socket.on('social_media_updated', (data) => console.log('Social:', data));
    socket.on('resources_updated', (data) => console.log('Resources:', data));
    return () => socket.disconnect();
  }, []);

  const fetchDisasters = async () => {
    try {
      const { data } = await axios.get('http://localhost:3001/disasters');
      setDisasters(data);
    } catch (error) {
      console.error('Error fetching disasters:', error);
    }
  };

  const createDisaster = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3001/disasters', {
        ...form,
        tags: form.tags.split(',').map(tag => tag.trim())
      });
      setForm({ title: '', description: '', tags: '' });
    } catch (error) {
      console.error('Error creating disaster:', error);
    }
  };

  const submitReport = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3001/disasters/123e4567-e89b-12d3-a456-426614174000/verify-image', {
        image_url: report.image_url
      });
      setReport({ content: '', image_url: '' });
    } catch (error) {
      console.error('Error submitting report:', error);
    }
  };

  return (
    <div>
      <h1>Disaster Response Platform</h1>
      <h2>Create Disaster</h2>
      <form onSubmit={createDisaster}>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Title"
          required
        />
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Description"
        />
        <input
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="Tags (comma-separated)"
        />
        <button type="submit">Create</button>
      </form>
      <h2>Submit Report</h2>
      <form onSubmit={submitReport}>
        <input
          value={report.content}
          onChange={(e) => setReport({ ...report, content: e.target.value })}
          placeholder="Report Content"
        />
        <input
          value={report.image_url}
          onChange={(e) => setReport({ ...report, image_url: e.target.value })}
          placeholder="Image URL"
        />
        <button type="submit">Submit Report</button>
      </form>
      <h2>Disasters</h2>
      <ul>
        {disasters.map((d) => (
          <li key={d.id}>{d.title} - {d.location_name} ({d.tags.join(', ')})</li>
        ))}
      </ul>
    </div>
  );
}

export default App;