const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const prodEnvLocal = path.join(__dirname, '.env.production.local');
const prodEnvStandard = path.join(__dirname, '.env.production');
const selectedEnvFile = fs.existsSync(prodEnvLocal) ? prodEnvLocal : (fs.existsSync(prodEnvStandard) ? prodEnvStandard : null);
let parsedEnv = {};
if (selectedEnvFile) {
	try {
		parsedEnv = dotenv.parse(fs.readFileSync(selectedEnvFile));
	} catch (e) {
		// fallback to empty if parse fails
	}
}
const prodEnvPath = fs.existsSync(prodEnvLocal) ? '.env.production.local' : '.env.production';

const resolvedApiKey = process.env.WHATSAPP_API_KEY || parsedEnv.WHATSAPP_API_KEY;
const resolvedWebhookToken = process.env.PROVIDER_WEBHOOK_TOKEN || parsedEnv.PROVIDER_WEBHOOK_TOKEN;

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
				PORT: process.env.PORT || parsedEnv.PORT || '4000',
				// WhatsApp credentials loaded securely from environment / secret manager or local env file
				...(resolvedApiKey ? { WHATSAPP_API_KEY: resolvedApiKey } : {}),
				...(resolvedWebhookToken ? { PROVIDER_WEBHOOK_TOKEN: resolvedWebhookToken } : {})
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
