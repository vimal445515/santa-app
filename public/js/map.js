document.addEventListener('DOMContentLoaded', () => {
    // Initialize Map centered on Kochi, Kerala, India
    const map = L.map('map').setView([9.9312, 76.2673], 13);

    // Tiles - OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // Icons
    const homeIcon = L.divIcon({
        html: '<i class="fas fa-home home-icon"></i>',
        className: 'marker-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });

    const santaIcon = L.divIcon({
        html: '<i class="fas fa-sleigh santa-icon"></i>',
        className: 'border-0 bg-transparent', // Remove default box
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });

    // State
    const giftModal = new bootstrap.Modal(document.getElementById('giftModal'));
    const addHomeModal = new bootstrap.Modal(document.getElementById('addHomeModal'));
    let currentHomeId = null;
    let homes = [];
    let santaMarker = null;
    let tempLatLng = null;

    // Fetch Homes
    async function loadHomes() {
        const res = await fetch('/api/homes');
        homes = await res.json();
        renderHomes();
    }

    function renderHomes() {
        // Clear existing markers if any (simple implementation: just add new ones for now or clear layer group)
        // Ideally use a LayerGroup, but for simplicity just adding to map.
        // Note: To avoid duplicates on re-render, we should strictly perform this.
        // For this demo, let's just add the ones we know about.

        homes.forEach(home => {
            // Check if marker already exists? Simplified: Just add always (might duplicate validity on heavy refresh)
            // Better:
            L.marker([home.lat, home.lng], { icon: homeIcon })
                .addTo(map)
                .on('click', () => openGiftManager(home));
        });
    }

    // Map Click to Add Home
    map.on('click', (e) => {
        tempLatLng = e.latlng;
        addHomeModal.show();
        // Reset input
        document.getElementById('newHomeAddress').value = '';
    });

    // Save New Home
    document.getElementById('saveHomeBtn').addEventListener('click', async () => {
        const address = document.getElementById('newHomeAddress').value;
        if (address && tempLatLng) {
            const res = await fetch('/api/homes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: tempLatLng.lat,
                    lng: tempLatLng.lng,
                    address: address
                })
            });
            const data = await res.json();
            if (data.success) {
                homes.push(data.home);
                L.marker([data.home.lat, data.home.lng], { icon: homeIcon })
                    .addTo(map)
                    .on('click', () => openGiftManager(data.home));
                addHomeModal.hide();
            }
        }
    });

    // Gift Manager Logic
    async function openGiftManager(home) {
        currentHomeId = home.id;
        document.getElementById('homeAddress').innerText = home.address;

        // Reset and show loading state for weather
        const weatherDiv = document.getElementById('home-weather-display');
        const tempSpan = document.getElementById('hw-temp');
        const condSpan = document.getElementById('hw-condition');

        weatherDiv.classList.remove('d-none');
        tempSpan.innerText = '--';
        condSpan.innerText = 'Loading...';

        renderGiftList(home.gifts);
        giftModal.show();

        // Fetch Weather
        try {
            const res = await fetch(`/api/weather?lat=${home.lat}&lng=${home.lng}`);
            const data = await res.json();
            if (!data.error) {
                tempSpan.innerText = data.temperature;
                condSpan.innerText = data.condition;
            } else {
                condSpan.innerText = 'Unavailable';
            }
        } catch (e) {
            condSpan.innerText = 'Error';
        }
    }

    function renderGiftList(gifts) {
        const list = document.getElementById('giftList');
        list.innerHTML = '';
        gifts.forEach((gift, index) => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `
                <span><i class="fas fa-gift text-warning me-2"></i>${gift}</span>
                <button class="btn btn-sm btn-outline-danger border-0" onclick="removeGift(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            list.appendChild(li);
        });
    }

    // Add Gift
    document.getElementById('addGiftBtn').addEventListener('click', async () => {
        const input = document.getElementById('newGiftInput');
        const gift = input.value.trim();
        if (!gift) return;

        const res = await fetch(`/api/homes/${currentHomeId}/gifts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gift })
        });
        const data = await res.json();
        if (data.success) {
            renderGiftList(data.gifts);
            input.value = '';
            // Update local state
            homes.find(h => h.id === currentHomeId).gifts = data.gifts;
        }
    });

    // Expose removeGift to global scope for onclick
    window.removeGift = async (index) => {
        const res = await fetch(`/api/homes/${currentHomeId}/gifts/${index}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            renderGiftList(data.gifts);
            homes.find(h => h.id === currentHomeId).gifts = data.gifts;
        }
    };

    // Remove Home
    document.getElementById('deleteHomeBtn').addEventListener('click', async () => {
        if (!confirm("Are you sure you want to remove this home?")) return;

        const res = await fetch(`/api/homes/${currentHomeId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            giftModal.hide();
            // Reload markers (simplest way to clear deleted one without tracking individual marker refs extensively)
            // Or better: reload map
            location.reload();
        }
    });

    // Socket.IO
    let socket = null;
    if (typeof io !== 'undefined') {
        socket = io();
    } else {
        console.warn("Socket.IO not loaded. Falling back to polling.");
    }

    // Santa Live Location Simulation
    async function updateSantaLocation() {
        // Initial fetch only, then socket updates
        const res = await fetch('/api/santa/location');
        const data = await res.json();
        updateMapMarker(data.lat, data.lng);
    }

    function updateMapMarker(lat, lng) {
        if (!santaMarker) {
            santaMarker = L.marker([lat, lng], { icon: santaIcon }).addTo(map);
        } else {
            santaMarker.setLatLng([lat, lng]);
        }

        // Pan map if it's the current user (optional, maybe distracting if exploring)
        // map.panTo([lat, lng]); 

        updateSantaWeather(lat, lng);
    }

    async function updateSantaWeather(lat, lng) {
        const badge = document.getElementById('santa-weather');
        const tempSpan = document.getElementById('santa-temp');

        try {
            const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
            const data = await res.json();
            if (!data.error) {
                badge.classList.remove('d-none');
                tempSpan.innerText = data.temperature;
                badge.title = data.condition;
            }
        } catch (e) {
            console.error("Santa Weather Error", e);
        }
    }

    // Real-time Geolocation Handling
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            console.log("Loc Update:", lat, lng);

            // Update local view
            updateMapMarker(lat, lng);

            // Send to Server
            if (socket) {
                socket.emit('updateLocation', { lat, lng });
            }

            // Pulse effect locally
            document.getElementById('live-status').classList.add('animate-pulse');
        }, (err) => {
            console.error("Geolocation denied or error:", err);
            document.getElementById('live-status').classList.remove('animate-pulse');
            document.getElementById('live-status').innerText = "Live Tracking Failed";
            document.getElementById('live-status').classList.replace('bg-success', 'bg-danger');
        }, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        });
    } else {
        alert("Geolocation is not supported by this browser.");
    }

    // Listen for updates from other Santas (or server broadcasts)
    if (socket) {
        socket.on('santaLocationUpdate', (coords) => {
            updateMapMarker(coords.lat, coords.lng);
        });
    }

    // Initial Load
    loadHomes();
    updateSantaLocation(); // Fetch initial state once
});
