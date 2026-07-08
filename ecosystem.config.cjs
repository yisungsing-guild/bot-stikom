const fs = require('fs');
const path = require('path');

const prodEnvLocal = path.join(__dirname, '.env.production.local');
const prodEnvPath = fs.existsSync(prodEnvLocal) ? '.env.production.local' : '.env.production';

module.exports = {
	apps: [
		{
			name: 'bot-stikom',
			script: 'src/index.js',
			cwd: __dirname,
			instances: 1,
			autorestart: true,
			max_restarts: 10,
			time: true,
			env_production: {
				NODE_ENV: 'production',
				DOTENV_CONFIG_PATH: prodEnvPath,
				PORT: '4000',
				// WhatsApp (Fonnte) production env
				WHATSAPP_API_KEY: 'bF5rBhvgXFffyhWW2fXE',
				PROVIDER_WEBHOOK_TOKEN: '093245f76124d3bfc4df785f7e429042bd8e8597a331b06a73d0e3df0b99da7c'
			}
		},
		{
			name: 'maintenance-scheduler',
			script: 'scripts/maintenanceScheduler.js',
			cwd: __dirname,
			instances: 1,
			autorestart: true,
			max_restarts: 5,
			time: true,
			env_production: {
				NODE_ENV: 'production',
				DOTENV_CONFIG_PATH: prodEnvPath,
				MAINTENANCE_HOUR: '3',  // 3 AM setiap hari
				MAINTENANCE_SESSION_IDLE_DAYS: '7',
				MAINTENANCE_UPLOAD_DAYS: '30',
				MAINTENANCE_BROADCAST_DAYS: '90',
				MAINTENANCE_TEMP_DAYS: '7',
				MAINTENANCE_LOG_DAYS: '14'
			}
		}
	]
};
