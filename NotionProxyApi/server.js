const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const cheerio = require('cheerio');

const fcmAdmin = require("firebase-admin");

const NOTION_TOKEN = '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'; // 🔐 Replace with your Notion token
const NOTION_VERSION = '2022-06-28';
//ef10ac6f79524ea49e4bc0997e0ee704 == DB-TradingJournal
//5e00bcb25c3d4276b1de54de3576894a == DB-MonthlyLog

// Load FCM SDKadmin service account key
// const serviceAccount = require('./serviceAccountKey.json');
// fcmAdmin.initializeApp({
//   credential: fcmAdmin.credential.cert(serviceAccount)
// });


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

app.post('/api/createNewEntry', async (req, res) => {
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

app.get('/api/news', async (req, res) => {
  try {
    const response = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.xml', {
      responseType: 'text',
      timeout: 15000,
      headers: { Accept: 'application/xml, text/xml' }
    });
    const $ = cheerio.load(response.data, { xmlMode: true });
    const allowedCurrencies = new Set(['EUR', 'USD']);
    const allowedImpacts = new Set(['High', 'Medium']);
    const news = [];

    $('event').each((_, element) => {
      const readField = (name) => $(element).find(name).first().text().trim();
      const currency = readField('country');
      const impact = readField('impact');
      const rawDate = readField('date');
      const time = readField('time');

      if (!allowedCurrencies.has(currency) || !allowedImpacts.has(impact) || !rawDate) {
        return;
      }

      const [month, day, year] = rawDate.split('-').map(Number);
      const eventDate = new Date(Date.UTC(year, month - 1, day));
      const date = `${eventDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${eventDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${day}`;

      news.push({
        date,
        time: time || '--:--',
        currency,
        event: readField('title'),
        impact
      });
    });

    res.json(news);
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({
      error: 'Failed to fetch and parse news',
      details: err.message
    });
  }
});

app.post("/api/sendNotif", async (req, res) => {
  const { token, title, body } = req.body;

  try {
    await fcmAdmin.messaging().send({
      token: token,
      notification: { title, body }
    });
    res.status(200).json({ message: "Notification sent successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({message:"Error sending notification",err});
  }
});

// Health check endpoint for connection monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'NotionProxyApi',
    timestamp: new Date().toISOString(),
    port: 3000
  });
});

app.post('/api/getPropFirmAccountSettings', async (req, res) => {
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

app.listen(3000, () => console.log('✅ Server running at http://localhost:3000'));
