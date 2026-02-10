# MARGA Enterprise Management System

A modern web-based enterprise management system for Marga Enterprises, built to replace the legacy VB.NET desktop application.

## 🚀 Live URL
- **Production:** `https://app.marga.biz` (after Hostinger setup)

## 📁 Project Structure

```
/Marga-App/
├── index.html              # Login page (entry point)
├── dashboard.html          # Main dashboard with sidebar navigation
├── README.md               # This file
│
├── shared/                 # Shared resources across all modules
│   ├── css/
│   │   ├── styles.css      # Global styles
│   │   └── dashboard.css   # Dashboard layout styles
│   └── js/
│       ├── firebase-config.js  # Firebase connection settings
│       ├── auth.js             # Authentication & role-based access
│       └── utils.js            # Utility functions
│
├── customers/              # Customer Management Module
│   ├── index.html
│   ├── css/customers.css
│   └── js/customers.js
│
├── billing/                # Billing Module (coming soon)
│   └── js/
│
├── collections/            # Collections Module (coming soon)
│   └── js/
│
└── assets/                 # Images, icons, etc.
```

## 🔐 Default Login

- **Username:** `admin`
- **Password:** `marga2025`

⚠️ **Change this in production!** Update in `shared/js/auth.js`

## 👥 User Roles

| Role | Access |
|------|--------|
| Admin | All modules |
| Billing | Customers, Billing, Reports |
| Collection | Customers, Collections, Reports |
| Service | Customers, Service, Inventory |
| Viewer | Customers, Reports (read-only) |

## 🔥 Firebase Configuration

The app connects to Firebase Firestore. Configuration is in `shared/js/firebase-config.js`.

**Current Project:** `sah-spiritual-journal`

### Collections Used:
- `tbl_companylist` - Companies
- `tbl_branchinfo` - Branches
- `tbl_billinfo` - Billing information
- `tbl_contractmain` - Machine contracts
- `tbl_machine` - Machine inventory
- `tbl_model` - Machine models
- `tbl_brand` - Brands
- `tbl_area` - Areas
- `tbl_city` - Cities
- `marga_users` - User accounts (optional)

## 🛠️ Development

### Local Testing
1. Open `index.html` in a browser
2. Login with default credentials
3. Navigate through modules

### Adding New Modules
1. Create folder: `/modulename/`
2. Add `index.html`, `css/`, `js/`
3. Add navigation link in `dashboard.html`
4. Update role permissions in `auth.js`

## 📦 Deployment to Hostinger

1. Create subdomain `app.marga.biz` in Hostinger
2. Connect GitHub repo OR upload files via FTP
3. Point subdomain to the `/Marga-App/` folder

## 🗓️ Roadmap

- [x] Login system with authentication
- [x] Dashboard with sidebar navigation
- [x] Customer Management module
- [ ] Billing module
- [ ] Collections module
- [ ] Service module
- [ ] Reports module
- [ ] User management (admin)

## 📚 Project Docs (Canonical)
- `HANDOFF.md` - what changed recently + what to do next
- `docs/MASTERPLAN.md` - vision, goals, constraints, migration strategy
- `docs/CHANGELOG.md` - versioned release notes

## 📝 License

Proprietary - Marga Enterprises © 2025
