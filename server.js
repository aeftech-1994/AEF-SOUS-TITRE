const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Configuration par défaut
const DEFAULT_CONFIG = {
    couleur: '#802B36',
    position: 'bas',
    taille: '35',
    police: 'Montserrat',
    titre_message: '',
    titre_active: false,
    titre_timer: 10,
    titre_timer_active: false,
    is_hidden: false,
    propresenter_api: 'http://192.168.1.22:49196'
};

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==================== CONFIGURATION ====================

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('[ERREUR] Lecture config:', err);
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log('[CONFIG] Sauvegardé');
        return true;
    } catch (err) {
        console.error('[ERREUR] Sauvegarde:', err);
        return false;
    }
}

let currentConfig = loadConfig();

// ==================== PROPRESENTER POLLING ====================

let lastText = '';
let isProPresenterConnected = false;

async function pollProPresenter() {
    try {
        const response = await fetch(`${currentConfig.propresenter_api}/v1/status/slide`, {
            timeout: 5000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        // Vérifier si la réponse a du contenu
        const text = await response.text();
        if (!text || text.trim() === '') {
            // Réponse vide, on ignore silencieusement
            return;
        }
        
        // Parser le JSON
        let data;
        try {
            data = JSON.parse(text);
        } catch (jsonErr) {
            // JSON invalide, on ignore silencieusement
            return;
        }
        
        const currentText = data.current?.text || '';
        
        // Première connexion réussie
        if (!isProPresenterConnected) {
            isProPresenterConnected = true;
            console.log('[ProPresenter] ✅ Connecté');
        }
        
        // Si le texte a changé, broadcaster à tous les clients
        if (currentText !== lastText) {
            lastText = currentText;
            broadcastToClients({
                type: 'text_update',
                text: currentText,
                timestamp: Date.now()
            });
        }
        
    } catch (err) {
        if (isProPresenterConnected) {
            console.error('[ProPresenter] ❌ Erreur:', err.message);
            isProPresenterConnected = false;
        }
    }
}

// Démarrer le polling toutes les 500ms
setInterval(pollProPresenter, 500);

// ==================== WEBSOCKET ====================

let clients = new Set();

wss.on('connection', (ws) => {
    console.log('[WebSocket] 🔌 Nouveau client connecté');
    clients.add(ws);
    
    // Envoyer la config actuelle au nouveau client
    ws.send(JSON.stringify({
        type: 'config',
        config: currentConfig
    }));
    
    // Envoyer le dernier texte connu
    ws.send(JSON.stringify({
        type: 'text_update',
        text: lastText,
        timestamp: Date.now()
    }));
    
    ws.on('close', () => {
        console.log('[WebSocket] 🔌 Client déconnecté');
        clients.delete(ws);
    });
    
    ws.on('error', (err) => {
        console.error('[WebSocket] ❌ Erreur:', err);
        clients.delete(ws);
    });
});

function broadcastToClients(message) {
    const data = JSON.stringify(message);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// ==================== ROUTES API ====================

// GET /api/config - Lire la configuration
app.get('/api/config', (req, res) => {
    res.json(currentConfig);
});

// POST /api/config - Écrire la configuration
app.post('/api/config', (req, res) => {
    console.log('[API] Mise à jour config');
    currentConfig = { ...currentConfig, ...req.body };
    
    if (saveConfig(currentConfig)) {
        // Broadcaster la nouvelle config à tous les clients
        broadcastToClients({
            type: 'config',
            config: currentConfig
        });
        res.json({ success: true, config: currentConfig });
    } else {
        res.status(500).json({ success: false, error: 'Erreur sauvegarde' });
    }
});

// GET /api/config/reset - Réinitialiser
app.get('/api/config/reset', (req, res) => {
    console.log('[API] Reset configuration');
    currentConfig = { ...DEFAULT_CONFIG };
    saveConfig(currentConfig);
    broadcastToClients({
        type: 'config',
        config: currentConfig
    });
    res.json({ success: true, config: currentConfig });
});

// GET /api/status - Statut du serveur
app.get('/api/status', (req, res) => {
    res.json({
        server: 'running',
        propresenter_connected: isProPresenterConnected,
        propresenter_api: currentConfig.propresenter_api,
        clients_connected: clients.size,
        last_text: lastText
    });
});

// ==================== DÉMARRAGE SERVEUR ====================

server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('  RÉGIE VIRTUELLE v4.0 - SERVEUR');
    console.log('========================================');
    console.log('');
    console.log('✅ Serveur démarré sur le port', PORT);
    console.log('');
    console.log('📄 Pages:');
    console.log('   Configuration: http://localhost:' + PORT + '/config.html');
    console.log('   Affichage OBS: http://localhost:' + PORT + '/display.html');
    console.log('');
    console.log('🎮 API ProPresenter:');
    console.log('   ' + currentConfig.propresenter_api);
    console.log('');
    
    const os = require('os');
    const interfaces = os.networkInterfaces();
    console.log('🌐 Accès réseau:');
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log('   http://' + iface.address + ':' + PORT + '/config.html');
                console.log('   http://' + iface.address + ':' + PORT + '/display.html');
            }
        }
    }
    console.log('');
    console.log('⏳ Attente connexion ProPresenter...');
    console.log('========================================');
});