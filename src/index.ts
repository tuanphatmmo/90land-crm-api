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

const sequelize = process.env.NODE_ENV === 'production' ? new Sequelize(
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
) : new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite',
  logging: false
});

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
  depositOne: { type: DataTypes.STRING },
  contractDuration: { type: DataTypes.STRING },
  petAllowed: { type: DataTypes.STRING },
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

// Sync DB — alter:true tự thêm column mới nếu thiếu
sequelize.sync({ alter: true }).then(async () => {
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

app.post('/api/register', async (req, res) => {
  const { username, password, name } = req.body;
  try {
    const existing = await User.findOne({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Tài khoản đã tồn tại' });
    
    const user = await User.create({ 
      username, 
      password, 
      name: name || username,
      role: 'sale' 
    });
    res.json({ status: 'ok', message: 'Đăng ký thành công', data: { id: (user as any).id, username: (user as any).username, role: (user as any).role, name: (user as any).name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi hệ thống: ' + error.message });
  }
});


// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Users CRUD
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.findAll();
    res.json({ status: 'ok', data: users });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.destroy({ where: { id: req.params.id } });
    res.json({ status: 'ok' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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

// Bulk Update Buildings (HH)
app.put('/api/buildings/bulk-update', async (req, res) => {
  try {
    const { ids, updateData } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No ids provided' });
    
    await Building.update(updateData, { where: { id: ids } });
    res.json({ status: 'ok' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk Delete Buildings
app.post('/api/buildings/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No ids provided' });
    
    await Room.destroy({ where: { BuildingId: ids } });
    await Building.destroy({ where: { id: ids } });
    res.json({ status: 'ok' });
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
    
    const hasRoom = rowStr.includes('phòng') || rowStr.includes('tên phòng') || rowStr.includes('phong');
    const hasPrice = rowStr.includes('giá') || rowStr.includes('gía') || rowStr.includes('vnd');
    const hasStatus = rowStr.includes('tình trạng') || rowStr.includes('hiện trạng') || rowStr.includes('trạng thái') || rowStr.includes('status') || rowStr.includes('t.trạng');
    
    if ((hasRoom && hasPrice && hasStatus) || (rowStr.includes('địa chỉ') && hasRoom && hasPrice && rowStr.includes('diện tích'))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx !== -1) {
    const headers = data[headerRowIdx];
    for (let j = 0; j < headers.length; j++) {
      const h = (headers[j] || '').toString().toLowerCase();
      if ((h.includes('địa chỉ') || h.includes('tòa') || h.includes('khu vực') || h.includes('dia chi')) && colMap.address === undefined) colMap.address = j; 
      if ((h.includes('phòng') || h.includes('tên phòng') || h.includes('phong')) && !h.includes('loại') && !h.includes('dạng') && colMap.room === undefined) colMap.room = j;
      if ((h.includes('giá') || h.includes('gía') || h.match(/\bgia\b/) || h.includes('vnd')) && !h.includes('thời gian') && colMap.price === undefined) colMap.price = j;
      if ((h.includes('tình trạng') || h.includes('hiện trạng') || h.includes('trạng thái') || h.includes('status') || h.includes('tgian vào ở')) && colMap.status === undefined) colMap.status = j;
      if ((h.includes('nội thất') || h.includes('thông tin phòng') || h.includes('tiện nghi')) && colMap.note === undefined) colMap.note = j;
      if ((h.includes('dịch vụ') || h.includes('phí')) && !h.includes('hoa hồng') && !h.includes('hđ dịch vụ') && colMap.service === undefined) colMap.service = j;
      if ((h.includes('ảnh') || h.includes('video')) && colMap.image === undefined) colMap.image = j;
      if (h.includes('diện tích') && colMap.area === undefined) colMap.area = j;
      if ((h.includes('loại') || h.includes('dạng')) && colMap.type === undefined) colMap.type = j;
    }
  }

  // Fallbacks if headers not found properly
  if (headerRowIdx === -1) {
    let scores = Array(25).fill(0).map(()=>({room:0, price:0, status:0, note:0, area:0, service:0, address:0, image:0}));
    for(let i=0; i<Math.min(50, data.length); i++) {
      const row = data[i]||[];
      for(let j=0; j<Math.min(25, row.length); j++) {
        const v = String(row[j]||'').toLowerCase();
        if(!v || v==='null') continue;
        if(v.match(/^(p\s*)?\d{3,4}$/i) && parseInt(v.replace(/\D/g,''))>100 && parseInt(v.replace(/\D/g,''))<9999) scores[j].room++;
        if(!isNaN(parseFloat(v.replace(/,/g,''))) && parseFloat(v.replace(/,/g,''))>500000) scores[j].price++;
        if(v.match(/\d+(?:\.\d+)?\s*(tr|triệu)/i)) scores[j].price++;
        if(v.includes('trống')||v.includes('cọc')||v.includes('thuê')||v.includes('kín')||v.includes('full')||v.includes('now')) scores[j].status++;
        if(v.includes('m2')) scores[j].area++;
        if(v.length>30 && (v.includes('nội thất')||v.includes('điều hòa')||v.includes('nóng lạnh')||v.includes('giường'))) scores[j].note++;
        if(v.includes('dịch vụ')||v.includes('rác')||v.includes('vệ sinh')) scores[j].service++;
        
        // Address heuristic: Must contain address keywords AND not be too long (to avoid notes/rules)
        if(v.length < 80 && (v.match(/\bngõ\b/) || v.match(/\bsố\b/) || v.match(/\bđường\b/) || v.match(/\bphố\b/) || v.match(/\bngách\b/))) {
           scores[j].address++;
        }
        
        if(v.includes('http')||v.includes('drive.google.com')||v.includes('zalo.me')) scores[j].image++;
      }
    }
    const maxScore = (key: string) => {
      let max = 0; let col = undefined;
      for(let j=0; j<25; j++) { if(scores[j][key as keyof typeof scores[0]] > max) { max = scores[j][key as keyof typeof scores[0]]; col = j; } }
      return col;
    };
    colMap.room = maxScore('room');
    colMap.price = maxScore('price');
    colMap.status = maxScore('status');
    colMap.area = maxScore('area');
    colMap.note = maxScore('note');
    colMap.service = maxScore('service');
    colMap.address = maxScore('address');
    colMap.image = maxScore('image');

    // Prevent overlap
    if (colMap.address === colMap.price || colMap.address === colMap.room || colMap.address === colMap.status) colMap.address = undefined;
  }

  // Skip sheets that have absolutely no identifiable room or price data
  if (colMap.room === undefined && colMap.price === undefined) continue;

  let currentArea = 'Hà Nội';
  let currentAddress = '';
  let currentBuilding: any = null;
  let addedCount = 0;
  let currentNote = '';
  let currentService = '';

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i] || [];

    // Skip completely empty rows
    if (row.length === 0) continue;
    let isNewAddress = false;

    // Smart Address Extraction (Row with a single non-empty string is often a building address)
    const nonNullCols = row.filter((x: any) => x && String(x).trim() !== '').length;
    if (nonNullCols === 1 && headerRowIdx === -1) {
      const val = String(row.find((x: any) => x && String(x).trim() !== '')).trim();
      
      const vLower = val.toLowerCase();
      const isLikelyAddress = (val.length > 5 && val.length < 80) && 
                              (vLower.includes('ngõ') || vLower.includes('số') || 
                               vLower.includes('đường') || vLower.includes('phố') || 
                               val.match(/\d+\/\d+/) || vLower.match(/tòa/i) || vLower.match(/chung cư/i));
      const isExcluded = vLower.match(/(điện|nước|mạng|wifi|dịch vụ|lưu ý|cơ chế|xe máy|xe điện|phí|nội thất|danh sách|trục|khách|cọc)/);

      if (isLikelyAddress && !isExcluded && !vLower.match(/^p?\d{3}$/)) {
         currentAddress = val;
         isNewAddress = true;
         // Clean up random garbage that usually follows address
         currentBuilding = null;
         continue; 
      }
    }

    const rowArea = row[0] || row[1];
    if (rowArea && typeof rowArea === 'string' && rowArea.toUpperCase().startsWith('QUẬN')) {
      currentArea = rowArea.replace(/QUẬN/i, '').trim();
      continue;
    }

    let isNewAddress_placeholder = false; // Just to make sure logic matches, wait, actually I can just remove the declaration
    if (colMap.address !== undefined && row[colMap.address] && typeof row[colMap.address] === 'string') {
      if (currentAddress !== row[colMap.address]) {
        currentAddress = row[colMap.address];
        isNewAddress = true;
      }
    }

    if (ws['!rows'] && ws['!rows'][i] && ws['!rows'][i].hidden) {
      continue;
    }

    if (isNewAddress) {
      currentNote = '';
      currentService = '';
    }

    if (colMap.note !== undefined && row[colMap.note] != null && String(row[colMap.note]).trim() !== '') {
      currentNote = String(row[colMap.note]);
    }
    if (colMap.service !== undefined && row[colMap.service] != null && String(row[colMap.service]).trim() !== '') {
      currentService = String(row[colMap.service]);
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
    const rawPriceCol = String(row[colMap.price] || '');
    const priceStr = rawPriceCol.replace(/,/g, '').replace(/\./g, '');
    let price = parseFloat(priceStr);
    
    // Extract 4tr3 -> 4300000
    const trMatch = rawPriceCol.match(/(\d+)(?:tr|\.|,)(\d+)?(?:tr|triệu)?/i);
    if(trMatch && rawPriceCol.toLowerCase().includes('tr')) {
      let val = parseFloat(trMatch[1] + '.' + (trMatch[2]||'0'));
      price = val * 1000000;
    }

    const statusStr = colMap.status !== undefined ? row[colMap.status] : '';
    const areaM2 = colMap.area !== undefined ? row[colMap.area] : '';
    const note = currentNote;
    const dichvu = currentService;

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
    // Use both status column AND price column to infer status (in case they are merged)
    const combinedStrForStatus = (String(statusStr || '') + ' ' + String(colMap.price !== undefined ? row[colMap.price] : '')).toLowerCase();
    if (combinedStrForStatus.includes('cọc')) status = 'Đã cọc';
    else if (combinedStrForStatus.includes('thuê') || combinedStrForStatus.includes('kín')) status = 'Đã thuê';

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
      if (urlToSync.includes('/file/d/')) {
        const match = urlToSync.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
          urlToSync = `https://docs.google.com/uc?export=download&id=${match[1]}`;
        }
      } else {
        const baseUrl = urlToSync.split('/edit')[0].split('/htmlview')[0].split('?')[0].split('#')[0];
        urlToSync = baseUrl + '/export?format=xlsx';
      }
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
