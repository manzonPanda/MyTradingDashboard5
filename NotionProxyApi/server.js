const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const NOTION_TOKEN = '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'; // 🔐 Replace with your Notion token
const NOTION_VERSION = '2022-06-28';
//ef10ac6f79524ea49e4bc0997e0ee704 == DB-TradingJournal
//5e00bcb25c3d4276b1de54de3576894a == DB-MonthlyLog

app.post('/api/createRelationId', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/pages',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.post('/api/getRelationName', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/databases/5e00bcb25c3d4276b1de54de3576894a/query',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.post('/api/getAllPagesFromDB', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/databases/ef10ac6f79524ea49e4bc0997e0ee704/query',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.patch('/api/patchRelationIdToTrade', async (req, res) => {
  try {
    // const url = "https://api.notion.com/v1/pages/" + req.url
    const pageId = req.body.url;
    const payload = req.body.payload;
    const response = await axios.patch(
      `https://api.notion.com/v1/pages/${pageId}`,
      req.body.payload,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.patch('/api/updatePropertiesToTrade', async (req, res) => {
  try {
    // const url = "https://api.notion.com/v1/pages/" + req.url
    const pageId = req.body.url;
    const payload = req.body.payload;
    const response = await axios.patch(
      `https://api.notion.com/v1/pages/${pageId}`,
      req.body.payload,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data.properties.PnL);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.listen(3000, () => console.log('✅ Server running at http://localhost:3000'));
