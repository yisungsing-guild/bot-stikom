require('dotenv').config();

async function testOpenAI() {
  console.log('🧪 Testing OpenAI API Connection...\n');
  
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  
  console.log(`📌 Model: ${model}`);
  console.log(`🔑 API Key: ${apiKey ? apiKey.substring(0, 20) + '...' : 'NOT FOUND'}\n`);
  
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY tidak ditemukan di .env');
    process.exit(1);
  }

  try {
    console.log('📡 Mengirim test request ke OpenAI...\n');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: 'Halo, ini test koneksi. Jawab dengan "OK" saja.'
          }
        ],
        max_completion_tokens: 50,
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ KONEKSI BERHASIL!\n');
      console.log('📨 Response dari OpenAI:');
      console.log('─────────────────────────────────');
      console.log(data.choices[0].message.content);
      console.log('─────────────────────────────────\n');
      console.log(`💰 Token Usage: ${data.usage.total_tokens} tokens`);
      console.log(`   - Prompt: ${data.usage.prompt_tokens}`);
      console.log(`   - Completion: ${data.usage.completion_tokens}\n`);
      console.log('✨ OpenAI API siap digunakan!');
    } else {
      console.error('❌ ERROR dari OpenAI:\n');
      console.error('Status:', response.status);
      console.error('Message:', data.error?.message || JSON.stringify(data, null, 2));
      
      if (data.error?.code === 'model_not_found') {
        console.error('\n⚠️  Model tidak ditemukan!');
        console.error('Model yang tersedia: gpt-4o, gpt-4-turbo, gpt-3.5-turbo, dll');
      }
      
      if (data.error?.code === 'invalid_api_key') {
        console.error('\n⚠️  API Key tidak valid!');
        console.error('Cek kembali OPENAI_API_KEY di file .env');
      }
    }
  } catch (error) {
    console.error('❌ ERROR saat testing:\n');
    console.error(error.message);
    console.error('\nPastikan:');
    console.error('1. Koneksi internet aktif');
    console.error('2. API Key valid');
    console.error('3. Model name benar');
  }
}

testOpenAI();
