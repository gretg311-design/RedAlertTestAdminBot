const express = require('express');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Переменные окружения из панели Render
const mongoUri = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Конфиг твоего репозитория
const GH_USER = "gretg311-design"; 
const GH_REPO = "gretg311-design/Red-Alert";

let db, playersCollection;

// Подключение к нашей MongoDB
MongoClient.connect(mongoUri)
    .then(client => {
        db = client.db(); // Имя базы подтянется из строки подключения автоматически
        playersCollection = db.collection('players'); // Замени 'players' на имя твоей коллекции, если оно другое
        console.log("Успешное подключение к MongoDB");
    })
    .catch(err => console.error("Ошибка подключения к MongoDB:", err));

// Валидация захода из Telegram Mini App
function verifyAdmin(req, res, next) {
    const initData = req.headers['x-tg-init-data'];
    if (!initData) return res.status(403).json({ error: "Нет данных авторизации" });

    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const dataCheckString = Array.from(urlParams.entries())
            .map(([key, value]) => `${key}=${value}`)
            .sort().join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash !== hash) return res.status(403).json({ error: "Ошибка валидации данных" });

        const user = JSON.parse(urlParams.get('user'));
        if (user.id !== ALLOWED_ADMIN_ID) return res.status(403).json({ error: "Доступ запрещен" });

        req.tgUser = user;
        next();
    } catch (err) {
        return res.status(500).json({ error: "Ошибка авторизации" });
    }
}

// 1. Получение списка ВСЕХ карт напрямую из папок GitHub
app.get('/api/git-cards', verifyAdmin, async (req, res) => {
    // Допиши сюда папки, какие у тебя там лежат в корень/card/...
    const categories = ['legendary', 'rare', 'common', 'epic']; 
    let allCards = [];

    const headers = { 'User-Agent': 'RedAlert-Admin-App' };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    for (const cat of categories) {
        try {
            const url = `https://api.github.com/repos/${GH_USER}/${GH_REPO}/contents/card/${cat}`;
            const response = await axios.get(url, { headers });
            
            const cards = response.data
                .filter(file => file.name.endsWith('.json'))
                .map(file => file.name.replace('.json', '')); // Получаем чистые ID карт

            allCards = allCards.concat(cards);
        } catch (error) {
            console.error(`Не удалось прочитать папку ${cat} на Гитхабе`);
        }
    }
    res.json(allCards);
});

// 2. Поиск игрока в Монге
app.get('/api/player/:id', verifyAdmin, async (req, res) => {
    const player = await playersCollection.findOne({ userId: Number(req.params.id) });
    if (!player) return res.status(404).json({ error: "Игрок не найден в БД" });
    res.json(player);
});

// 3. Выдача монет в Монгу ($inc сработает и в плюс, и в минус)
app.post('/api/player/:id/coins', verifyAdmin, async (req, res) => {
    const { amount } = req.body;
    await playersCollection.updateOne(
        { userId: Number(req.params.id) },
        { $inc: { coins: Number(amount) } }
    );
    res.json({ success: true });
});

// 4. Выдача карты в массив игрока ($push)
app.post('/api/player/:id/give-card', verifyAdmin, async (req, res) => {
    const { cardCode } = req.body;
    await playersCollection.updateOne(
        { userId: Number(req.params.id) },
        { $push: { cards: cardCode } } // Предполагаю, у тебя массив 'cards' в схеме игрока
    );
    res.json({ success: true });
});

// 5. Снятие дрона-соглядатая ($set в false)
app.post('/api/player/:id/remove-drone', verifyAdmin, async (req, res) => {
    await playersCollection.updateOne(
        { userId: Number(req.params.id) },
        { $set: { droneActive: false } } // Меняй поле под твое имя в Монге
    );
    res.json({ success: true });
});

// 6. Сброс кулдаунов (очистка объекта или флагов таймеров)
app.post('/api/player/:id/reset-cooldowns', verifyAdmin, async (req, res) => {
    await playersCollection.updateOne(
        { userId: Number(req.params.id) },
        { $set: { cooldowns: {} } } // Меняй поле под твою структуру КД
    );
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Админ-панель запущена на порту ${PORT}`));
