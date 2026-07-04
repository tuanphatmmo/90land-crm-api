import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Sequelize, DataTypes } from 'sequelize';
import multer from 'multer';
import xlsx from 'xlsx';
import cron from 'node-cron';
import axios from 'axios';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Initialize Database — MySQL (Railway / Render)
const sequelize = new Sequelize(
  process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
  process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
  process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD || '',
  {
    host: process.env.MYSQLHOST || 'mysql.railway.internal',
    port: parseInt(process.env.MYSQLPORT || '3306'),
    dialect: 'mysql',
    logging: false,
    dialectOptions: { connectTimeout: 60000 },
  }
);

// Define Models
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'sale'), defaultValue: 'sale' },
  name: { type: DataTypes.STRING, allowNull: false },
  office: { type: DataTypes.STRING },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const Building = sequelize.define('Building', {
  code: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.STRING, allowNull: false },
  area: { type: DataTypes.STRING, allowNull: false },
  source: { type: DataTypes.STRING, defaultValue: 'manual' }, // sheet, zalo, manual
  priority: { type: DataTypes.STRING, defaultValue: 'Ưu tiên vừa' },
  commission: { type: DataTypes.STRING, defaultValue: '50%' },
  note: { type: DataTypes.TEXT },
  image_link: { type: DataTypes.TEXT },
});

const Room = sequelize.define('Room', {
  room_num: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false },
  area_m2: { type: DataTypes.STRING },
  type: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Trống', 'Đã cọc', 'Đã thuê', 'Tạm khóa'), defaultValue: 'Trống' },
  furniture: { type: DataTypes.TEXT },   // Nội thất
  services: { type: DataTypes.TEXT },    // Dịch vụ
});

Building.hasMany(Room);
Room.belongsTo(Building);

const Customer = sequelize.define('Customer', {
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: false },
  socialLink: { type: DataTypes.STRING }, // FB/Zalo
  needs: { type: DataTypes.TEXT },
  budget: { type: DataTypes.STRING },
  desiredArea: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Chưa gọi', 'Đã gọi', 'Đang tư vấn', 'Đi xem phòng', 'Chốt cọc', 'Hủy'), defaultValue: 'Chưa gọi' },
});

User.hasMany(Customer, { foreignKey: 'saleId' });
Customer.belongsTo(User, { as: 'Sale', foreignKey: 'saleId' });

// Sync DB
sequelize.sync({ alter: false }).then(async () => {
  console.log('Database synced.');
  // Seed default users
  const adminExists = await User.findOne({ where: { username: 'admin' } });
  if (!adminExists) {
    await User.create({ username: 'admin', password: '1', role: 'admin', name: 'Quản trị viên' });
  }
  const saleExists = await User.findOne({ where: { username: 'sale' } });
  if (!saleExists) {
    await User.create({ username: 'sale', password: '1', role: 'sale', name: 'Nhân viên Sale' });
  }
});

// Routes
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ where: { username, password } });
  if (!user) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  res.json({ status: 'ok', data: { id: (user as any).id, username: (user as any).username, role: (user as any).role, name: (user as any).name } });
});


// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Buildings CRUD
app.get('/api/buildings', async (req, res) => {
  const buildings = await Building.findAll({ include: [Room] });
  res.json({ data: buildings });
});

app.post('/api/buildings', async (req, res) => {
  try {
    const b = await Building.create(req.body);
    res.json({ status: 'ok', data: b });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/buildings/:id', async (req, res) => {
  try {
    const b = await Building.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    await b.update(req.body);
    res.json({ status: 'ok', data: b });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/buildings/:id', async (req, res) => {
  try {
    await Room.destroy({ where: { BuildingId: req.params.id } });
    await Building.destroy({ where: { id: req.params.id } });
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Rooms CRUD
app.get('/api/rooms', async (req, res) => {
  const rooms = await Room.findAll({ include: [Building] });
  res.json({ data: rooms });
});

app.post('/api/rooms', async (req, res) => {
  try {
    const r = await Room.create(req.body);
    res.json({ status: 'ok', data: r });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Not found' });
    await room.update(req.body);
    res.json({ status: 'ok', data: room });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/rooms/:id', async (req, res) => {
  try {
    await Room.destroy({ where: { id: req.params.id } });
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Function to process excel data
const processExcelData = async (buffer: any, customCode?: string, sheetGid?: string) => {
  const wb = xlsx.read(buffer, { type: 'buffer', cellStyles: true });
  
  let totalAdded = 0;
  
  // Process ALL sheets - gid-based tab selection is unreliable
  for (const targetSheetName of wb.SheetNames) {
  const ws = wb.Sheets[targetSheetName];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];

  let headerRowIdx = -1;
  let colMap: any = {};

  for (let i = 0; i < Math.min(25, data.length); i++) {
    // Strip newlines so "TÌNH \nTRẠNG" matches "tình trạng"
    const rowStr = (data[i] || []).map((c: any) => String(c || '')).join(' ').replace(/\n/g, ' ').toLowerCase();
    if ((rowStr.includes('phòng') || rowStr.includes('tên phòng')) && rowStr.includes('giá') && (rowStr.includes('tình trạng') || rowStr.includes('trạng thái') || rowStr.includes('status'))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx !== -1) {
    const headers = data[headerRowIdx];
    for (let j = 0; j < headers.length; j++) {
      const h = (headers[j] || '').toString().toLowerCase();
      if ((h.includes('địa chỉ') || h.includes('tòa') || h.includes('khu vực')) && !colMap.address) colMap.address = j; 
      if ((h.includes('phòng') || h.includes('tên phòng')) && !h.includes('loại') && !h.includes('dạng') && colMap.room === undefined) colMap.room = j;
      if (h.includes('giá') && colMap.price === undefined) colMap.price = j;
      if ((h.includes('tình trạng') || h.includes('trạng thái') || h.includes('status') || h.includes('tgian vào ở')) && colMap.status === undefined) colMap.status = j;
      if (h.includes('nội thất') && colMap.note === undefined) colMap.note = j;
      if ((h.includes('dịch vụ') || h.includes('phí')) && colMap.service === undefined) colMap.service = j;
      if ((h.includes('ảnh') || h.includes('video')) && colMap.image === undefined) colMap.image = j;
      if (h.includes('diện tích') && colMap.area === undefined) colMap.area = j;
      if ((h.includes('loại') || h.includes('dạng')) && colMap.type === undefined) colMap.type = j;
    }
  }

  // Fallbacks if headers not found properly
  if (colMap.address === undefined) colMap.address = 1;
  if (colMap.room === undefined) colMap.room = 3;
  if (colMap.price === undefined) colMap.price = 4;
  if (colMap.status === undefined) colMap.status = 5;

  let currentArea = 'Hà Nội';
  let currentAddress = '';
  let currentBuilding: any = null;
  let addedCount = 0;
  
  if (headerRowIdx === -1) continue; // Skip sheets without recognized headers

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i] || [];

    // Skip completely empty rows
    if (row.length === 0) continue;

    const rowArea = row[0] || row[1];
    if (rowArea && typeof rowArea === 'string' && rowArea.toUpperCase().startsWith('QUẬN')) {
      currentArea = rowArea.replace(/QUẬN/i, '').trim();
      continue;
    }

    if (colMap.address !== undefined && row[colMap.address] && typeof row[colMap.address] === 'string') {
      currentAddress = row[colMap.address];
    }

    if (ws['!rows'] && ws['!rows'][i] && ws['!rows'][i].hidden) {
      continue;
    }

    // Default address if none found
    let address = currentAddress;
    if (!address) {
      // Check if address is buried in a note cell
      for (let c = 0; c < 20; c++) {
        if (typeof row[c] === 'string' && row[c].toLowerCase().includes('địa chỉ :')) {
          const match = row[c].match(/địa chỉ\s*:\s*([^\n]+)/i);
          if (match) {
            address = match[1].trim();
            break;
          }
        }
      }
    }
    if (!address) {
      address = customCode ? 'Địa chỉ chưa cập nhật (' + customCode + ')' : 'Chưa cập nhật địa chỉ';
    }
    const type = colMap.type !== undefined ? row[colMap.type] : '';
    const roomNumRaw = row[colMap.room];
    const priceStr = String(row[colMap.price] || '').replace(/,/g, '').replace(/\./g, '');
    const price = parseFloat(priceStr);
    const statusStr = colMap.status !== undefined ? row[colMap.status] : '';
    const areaM2 = colMap.area !== undefined ? row[colMap.area] : '';
    const note = (colMap.note !== undefined ? (row[colMap.note] || '') : '');
    const dichvu = (colMap.service !== undefined ? (row[colMap.service] || '') : '');

    const excelRow = i + 1;
    let imageLink = '';
    
    // ALWAYS scan hyperlinks first — they are the reliable source
    for (let c = 0; c < 25; c++) {
      const colLetter = xlsx.utils.encode_col(c);
      const cell = ws[colLetter + excelRow];
      if (cell && cell.l && cell.l.Target && cell.l.Target.startsWith('http')) {
        imageLink = cell.l.Target;
        break;
      }
    }
    
    // If no hyperlink found, check if cell value itself is a URL
    if (!imageLink) {
      const rawImg = colMap.image !== undefined ? (row[colMap.image] || '') : '';
      if (typeof rawImg === 'string' && rawImg.startsWith('http')) {
        imageLink = rawImg;
      }
    }
    
    // Double-check imageLink is an actual URL, not text like "Hình ảnh, video"
    if (imageLink && !imageLink.startsWith('http')) {
      imageLink = '';
    }

    if (!address || !roomNumRaw || isNaN(price)) continue;

    if (!currentBuilding || currentBuilding.address !== address) {
      if (customCode) {
        currentBuilding = await Building.findOne({ where: { address, code: customCode } });
      } else {
        currentBuilding = await Building.findOne({ where: { address } });
      }
      
      if (!currentBuilding) {
        let bCode = customCode || ('MT' + Math.floor(Math.random() * 10000));
        currentBuilding = await Building.create({
          code: bCode,
          name: '',
          address,
          area: currentArea,
          source: 'sheet',
          note: note + '\n' + dichvu,
          image_link: imageLink
        });
      } else if (imageLink && !currentBuilding.image_link) {
        await currentBuilding.update({ image_link: imageLink });
      }
    } else if (imageLink && !currentBuilding.image_link) {
      await currentBuilding.update({ image_link: imageLink });
    }

    let status = 'Trống';
    if (statusStr && typeof statusStr === 'string') {
      const s = statusStr.toLowerCase();
      if (s.includes('cọc')) status = 'Đã cọc';
      else if (s.includes('thuê') || s.includes('kín')) status = 'Đã thuê';
    }

    const roomNums = String(roomNumRaw).split('\\n').map(r => r.trim()).filter(Boolean);

    for (const rNum of roomNums) {
      const existingRoom = await Room.findOne({ where: { BuildingId: currentBuilding.id, room_num: rNum } });
      if (existingRoom) {
        await existingRoom.update({ price, type, status, area_m2: areaM2, furniture: note, services: dichvu });
        addedCount++;
      } else {
        await Room.create({
          BuildingId: currentBuilding.id,
          room_num: rNum,
          price,
          type,
          status,
          area_m2: areaM2,
          furniture: note,
          services: dichvu
        });
        addedCount++;
      }
    }
  }
  totalAdded += addedCount;
  } // end for each sheet
  return totalAdded;
};

// Import Local Excel
app.post('/api/import-excel', upload.single('file'), async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const fs = require('fs');
    const buffer = fs.readFileSync(req.file.path);
    const addedCount = await processExcelData(buffer);
    res.json({ status: 'ok', added: addedCount, message: 'Đã import dữ liệu thành công' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Import Google Sheets
import fs from 'fs';
const getConfig = () => {
  try {
    const data = fs.readFileSync('sheet_config.json', 'utf8');
    return JSON.parse(data);
  } catch {
    return {
      url: 'https://docs.google.com/spreadsheets/d/1-eAgUNaN6gw2H0ED5yzmmcFPso7XkdUMTUh9QX9RKiU/export?format=xlsx',
      code: ''
    };
  }
};

app.post('/api/sync-sheets', async (req: any, res: any) => {
  try {
    const { sheetUrl, buildingCode } = req.body;
    let config = getConfig();
    let urlToSync = sheetUrl || config.url;
    let codeToSync = buildingCode !== undefined ? buildingCode : config.code;

    // Save new config if provided
    if (sheetUrl !== undefined || buildingCode !== undefined) {
      // Strip gid from URL - we handle sheet selection ourselves
      let gidValue = '';
      if (urlToSync.includes('gid=')) {
        const match = urlToSync.match(/[?&#]gid=([0-9]+)/);
        if (match) gidValue = match[1];
      }
      // Clean URL for export (remove /edit, query params, hash)
      const baseUrl = urlToSync.split('/edit')[0].split('?')[0].split('#')[0];
      urlToSync = baseUrl + '/export?format=xlsx';
      fs.writeFileSync('sheet_config.json', JSON.stringify({ url: urlToSync, code: codeToSync, gid: gidValue }));
    }

    const savedConfig = JSON.parse(fs.readFileSync('sheet_config.json', 'utf8'));
    const response = await axios.get(savedConfig.url, { responseType: 'arraybuffer' });
    const addedCount = await processExcelData(response.data, codeToSync, savedConfig.gid || undefined);
    res.json({ status: 'ok', added: addedCount, message: 'Đã đồng bộ Google Sheets thành công' });
  } catch (error: any) {
    console.error('Lỗi sync:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cron job 1 tiếng chạy 1 lần
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Đang tự động đồng bộ Google Sheets...');
  try {
    const config = getConfig();
    const response = await axios.get(config.url, { responseType: 'arraybuffer' });
    const added = await processExcelData(response.data, config.code);
    console.log(`[CRON] Đồng bộ thành công: ${added} phòng`);
  } catch (err: any) {
    console.error('[CRON] Đồng bộ thất bại:', err.message);
  }
});

// Customers
app.get('/api/customers', async (req: any, res: any) => {
  const customers = await Customer.findAll({ include: ['Sale'] });
  res.json({ data: customers });
});

app.listen(port, () => {
  console.log(`API Server running on port ${port}`);
});
