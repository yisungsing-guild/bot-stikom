# WhatsApp Bot Admin Panel - User Guide

## Overview
This is a modern, professional admin dashboard for managing WhatsApp bot operations. The interface features a dark theme with a responsive sidebar navigation and comprehensive feature modules.

## Project Structure

### Core Files
- **`app/layout.tsx`** - Root layout with sidebar and header
- **`app/page.tsx`** - Home page (redirects to dashboard)
- **`app/globals.css`** - Dark theme styling with OKLCH color variables

### Navigation Components
- **`components/sidebar.tsx`** - Left navigation sidebar with all feature links
- **`components/header.tsx`** - Top header with search, notifications, and user profile
- **`components/stat-card.tsx`** - Reusable statistics card component

### Feature Pages

#### 1. **Dashboard** (`/dashboard`)
- Overview of bot performance with key metrics
- Real-time activity feed showing recent messages
- System health indicators (bot status, API, database)
- Interactive charts with message statistics
- Recent messages table with status badges

#### 2. **Keyword** (`/keyword`)
- Manage bot keywords and their responses
- Search and filter capabilities
- Quick response mapping
- Edit/delete keyword functionality
- Displays match counts for each keyword

#### 3. **Menu** (`/menu`)
- Configure bot menu structure
- Nested menu item management
- Menu item status tracking (active/inactive)
- Sub-menu configuration
- Preview functionality

#### 4. **Setting** (`/setting`)
- Bot configuration with tabbed interface
- API key management with secure display
- Webhook URL configuration
- Feature toggles (auto-response, analytics, human handoff, typing indicator)
- Bot name and description setup

#### 5. **Broadcast** (`/broadcast`)
- Send messages to multiple users
- Schedule broadcasts for future delivery
- Track broadcast status and delivery rate
- View broadcast history
- Edit scheduled messages
- Success rate metrics

#### 6. **Live Chat** (`/live-chat`)
- Real-time chat interface with active customers
- Chat list with online status indicators
- Message history with timestamp
- Send/receive message functionality
- Contact quick access

#### 7. **History** (`/history`)
- Message history logs and search
- Filter by date, type (incoming/outgoing), and status
- Export functionality
- Message statistics and metrics
- Comprehensive message delivery tracking

#### 8. **Training Data** (`/training-data`)
- Upload and manage training datasets
- Dataset validation with accuracy metrics
- Model retraining triggers
- Bulk sample management
- Dataset status tracking (processing/validated)
- Recent activity log

#### 9. **WhatsApp** (`/whatsapp`)
- WhatsApp connection configuration
- QR code for device pairing
- Phone number verification
- Webhook configuration
- API credentials management
- Connection activity log
- Security features for credential rotation

#### 10. **Testing** (`/testing`)
- Test bot responses with real inputs
- Pre-configured test scenarios
- Run all scenarios at once
- Test result history with response times
- Performance metrics (success rate, avg response time)
- Result clearing and management

## Design System

### Color Scheme (Dark Theme)
- **Background**: Deep navy (#1a1a2e)
- **Card**: Dark gray (#16213e)
- **Primary**: Blue accent (#3a87f5)
- **Border**: Subtle dark border (#22222e)
- **Text**: Light text for contrast

### Typography
- **Font**: Geist Sans (default system font)
- **Headings**: Bold, 30px-32px for main titles
- **Body**: Regular, 14px-16px for content

### Components Used
- shadcn/ui components (Button, Card, Input, Table, Badge, etc.)
- Lucide React icons for all UI elements
- Tailwind CSS for responsive layout

## Key Features

### Navigation
- Fixed left sidebar (256px wide) with smooth transitions
- Active page highlighting with visual indicators
- Responsive design adapts for mobile devices
- Logout button in sidebar footer

### Header
- Search functionality for quick navigation
- Notification bell with indicator
- User profile dropdown menu
- Responsive mobile support

### Tables
- Sortable data tables with badges for status
- Action buttons (edit, delete) on each row
- Search and filter capabilities
- Pagination support

### Forms
- Organized form sections
- Input validation ready
- Toggle switches for boolean settings
- Select dropdowns for options

## Customization

### Adding New Features
1. Create new page in `/app/[feature-name]/page.tsx`
2. Add navigation item to `sidebar.tsx`
3. Follow existing component patterns for consistency

### Styling
- All colors use OKLCH color variables defined in `globals.css`
- Modify color values in the `.dark` section to change theme
- Use Tailwind classes for responsive design

### Icons
- Replace icons from `lucide-react` library
- All icons are imported and ready to use
- Consistent 16px-24px sizing throughout

## Getting Started

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Access the admin panel**:
   - Open http://localhost:3000
   - You'll be automatically redirected to the dashboard

3. **Navigate between features**:
   - Click any item in the left sidebar
   - Use the header search for quick navigation

## Development Tips

- Use the existing component library in `/components/ui`
- Follow the same page structure pattern for consistency
- Use Tailwind's responsive prefixes (md:, lg:) for mobile compatibility
- Keep component files modular and reusable

## Future Enhancements

- Database integration for data persistence
- Real-time updates with WebSocket
- User authentication and authorization
- Export/import functionality
- Advanced analytics and reporting
- Mobile app companion
- Team collaboration features
