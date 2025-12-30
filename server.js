require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

// Mock Data / Default Data (Kochi)
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || 9.9312);
const DEFAULT_LNG = parseFloat(process.env.DEFAULT_LNG || 76.2673);

const DEFAULT_HOMES = [
    { id: 1, lat: DEFAULT_LAT, lng: DEFAULT_LNG, address: "Kochi Main Base", gifts: ["Kringles", "Spices"] },
    { id: 2, lat: DEFAULT_LAT + 0.0088, lng: DEFAULT_LNG + 0.0027, address: "Marine Drive", gifts: ["Toy Boat"] },
    { id: 3, lat: DEFAULT_LAT + 0.0038, lng: DEFAULT_LNG - 0.0073, address: "Fort Kochi", gifts: ["Antique Compass"] }
];
const DEFAULT_SANTA = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };

let homes = [];
let santaLocation = {};

// Load Data
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE);
            const data = JSON.parse(raw);
            homes = data.homes || DEFAULT_HOMES;
            santaLocation = data.santaLocation || DEFAULT_SANTA;
            console.log("Data loaded from store.");
        } else {
            homes = [...DEFAULT_HOMES];
            santaLocation = { ...DEFAULT_SANTA };
            saveData(); // Create file
        }
    } catch (e) {
        console.error("Error loading data:", e);
        homes = [...DEFAULT_HOMES];
        santaLocation = { ...DEFAULT_SANTA };
    }
}

// Save Data
function saveData() {
    try {
        const data = { homes, santaLocation };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error saving data:", e);
    }
}

// Initial Load
loadData();

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

// API: Get all homes
app.get('/api/homes', (req, res) => {
    res.json(homes);
});

// API: Add a new home
app.post('/api/homes', (req, res) => {
    const { lat, lng, address } = req.body;
    if (lat && lng && address) {
        const newHome = {
            id: Date.now(), // Unique ID
            lat,
            lng,
            address,
            gifts: []
        };
        homes.push(newHome);
        saveData();
        res.json({ success: true, home: newHome });
    } else {
        res.status(400).json({ error: "Invalid data" });
    }
});

// API: Add a gift to a home
app.post('/api/homes/:id/gifts', (req, res) => {
    const homeId = parseInt(req.params.id);
    const { gift } = req.body;
    const home = homes.find(h => h.id === homeId);
    if (home && gift) {
        home.gifts.push(gift);
        saveData();
        res.json({ success: true, gifts: home.gifts });
    } else {
        res.status(404).json({ error: "Home not found or invalid gift" });
    }
});

// API: Remove a gift
app.delete('/api/homes/:id/gifts/:giftIndex', (req, res) => {
    const homeId = parseInt(req.params.id);
    const giftIndex = parseInt(req.params.giftIndex);
    const home = homes.find(h => h.id === homeId);

    if (home && giftIndex >= 0 && giftIndex < home.gifts.length) {
        home.gifts.splice(giftIndex, 1);
        saveData();
        res.json({ success: true, gifts: home.gifts });
    } else {
        res.status(404).json({ error: "Home or Gift not found" });
    }
});

// API: Remove a home
app.delete('/api/homes/:id', (req, res) => {
    const homeId = parseInt(req.params.id);
    const index = homes.findIndex(h => h.id === homeId);
    if (index !== -1) {
        homes.splice(index, 1);
        saveData();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Home not found" });
    }
});

// API: Update Santa's Location (Legacy Fallback)
app.post('/api/santa/location', (req, res) => {
    const { lat, lng } = req.body;
    if (lat && lng) {
        santaLocation = { lat, lng };
        saveData();
        res.json({ success: true, location: santaLocation });
    } else {
        res.status(400).json({ error: "Invalid coordinates" });
    }
});

app.get('/api/santa/location', (req, res) => {
    res.json(santaLocation);
});

// ... existing code ...

const axios = require('axios');
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Remove Server-side Simulation
// Santa's location is now driven by the client (Real-time Geolocation)

io.on('connection', (socket) => {
    console.log('A user connected');

    // Send current knowing location on connect
    socket.emit('santaLocationUpdate', santaLocation);

    socket.on('updateLocation', (coords) => {
        if (coords.lat && coords.lng) {
            santaLocation = { lat: coords.lat, lng: coords.lng };
            saveData();
            // Broadcast to everyone else (and sender if needed, though sender updates locally)
            io.emit('santaLocationUpdate', santaLocation);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Helper function to interpret WMO Weather Codes
function getWeatherDescription(code) {
    // ... existing code ...
    const codes = {
        0: 'Clear sky',
        1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Fog', 48: 'Depositing rime fog',
        51: 'Light Drizzle', 53: 'Moderate Drizzle', 55: 'Dense Drizzle',
        61: 'Slight Rain', 63: 'Moderate Rain', 65: 'Heavy Rain',
        71: 'Slight Snow', 73: 'Moderate Snow', 75: 'Heavy Snow',
        77: 'Snow grains',
        80: 'Slight Rain Showers', 81: 'Moderate Rain Showers', 82: 'Violent Rain Showers',
        85: 'Slight Snow Showers', 86: 'Heavy Snow Showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
    };
    return codes[code] || 'Unknown';
}

// API: Get Weather (Proxy to Open-Meteo)
app.get('/api/weather', async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: "Missing coordinates" });
    }

    try {
        const apiUrl = process.env.WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast';
        const response = await axios.get(`${apiUrl}?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const weather = response.data.current_weather;

        res.json({
            temperature: weather.temperature,
            windspeed: weather.windspeed,
            condition: getWeatherDescription(weather.weathercode),
            is_day: weather.is_day
        });
    } catch (error) {
        console.error("Weather API Error:", error.message);
        res.status(500).json({ error: "Failed to fetch weather data" });
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
