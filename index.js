const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-eda-app.netlify.app';

function makeReferralCode(username) {
  const base = String(username || 'EDA').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8) || 'EDA';
  return 'EDA-' + base + '-' + Math.floor(Math.random() * 9000 + 1000);
}

async function getOrCreateUser(ctx) {
  const telegramId = ctx.from.id;
  const { data: existing } = await supabase.from('tg_users').select('*').eq('telegram_id', telegramId).maybeSingle();
  if (existing) return existing;
  const username = ctx.from.username || `user${telegramId}`;
  const newUser = {
    telegram_id: telegramId, username: username,
    first_name: ctx.from.first_name || '', last_name: ctx.from.last_name || '',
    eda_username: username, referral_code: makeReferralCode(username),
    points: 0, total_xp: 0, balance: 0, drb_balance: 0, status: 'active'
  };
  const { data: created, error } = await supabase.from('tg_users').insert(newUser).select().single();
  if (error) {
    const { data: retry } = await supabase.from('tg_users').select('*').eq('telegram_id', telegramId).maybeSingle();
    if (retry) return retry;
  }
  return created;
}

async function getSession(telegramId) {
  const { data } = await supabase.from('tg_sessions').select('*').eq('telegram_id', telegramId).maybeSingle();
  return data || { telegram_id: telegramId, state: 'idle' };
}

async function updateSession(telegramId, updates) {
  await supabase.from('tg_sessions').upsert({ telegram_id: telegramId, ...updates, updated_at: new Date().toISOString() });
}

async function addPoints(telegramId, points, gameType, isCorrect) {
  const { data: user } = await supabase.from('tg_users').select('*').eq('telegram_id', telegramId).single();
  if (!user) return;
  const newPoints = Number(user.points || 0) + points;
  const newXP = Number(user.total_xp || 0) + (isCorrect ? 5 : 1);
  await supabase.from('tg_users').update({ points: newPoints, total_xp: newXP, updated_at: new Date().toISOString() }).eq('telegram_id', telegramId);
  await supabase.from('tg_game_history').insert({ telegram_id: telegramId, game_type: gameType, points_earned: points, is_correct: isCorrect });
}

function generateMath() {
  const a = 1000 + Math.floor(Math.random() * 9000);
  const b = 1000 + Math.floor(Math.random() * 9000);
  const ops = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { question: `${a} ${op} ${b} = ?`, answer: String(ans), type: 'math' };
}

function generateTrivia() {
  const items = [
    ['Capital of the Philippines?', 'Manila', ['Cebu', 'Davao', 'Quezon City']],
    ['Days in a week?', '7', ['5', '6', '8']],
    ['Red Planet?', 'Mars', ['Venus', 'Jupiter', 'Saturn']],
    ['H2O is called?', 'Water', ['Oxygen', 'Salt', 'Hydrogen']],
    ['How many continents?', '7', ['5', '6', '8']]
  ];
  const x = items[Math.floor(Math.random() * items.length)];
  return { question: x[0], answer: x[1], type: 'trivia', choices: x[2] };
}

bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const name = ctx.from.first_name || 'Friend';
  const keyboard = Markup.keyboard([
    ['🎮 Play Games', '🏆 Leaderboard'],
    ['💰 My Stats', '🔗 Referral Link'],
    ['📜 FAQ', '🌐 Open Web App']
  ]).resize();
  await ctx.replyWithMarkdown(
    `👑 *Welcome to EDA Bot, ${name}!*\n\n🎉 *E-Digital Academy*\n\n⭐ Points: *${user.points}* PTS\n💰 DRB: *₱${user.drb_balance}*\n\nPumili sa menu! 👇`,
    keyboard
  );
});

bot.command('play', async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🧮 Math', 'game_math')],
    [Markup.button.callback('🧠 Trivia', 'game_trivia')]
  ]);
  await ctx.replyWithMarkdown(`🎮 *Play Games*\n\n⭐ Total: *${user.points}* PTS`, keyboard);
});

bot.command('stats', async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.replyWithMarkdown(`📊 *Your Stats*\n\n👤 @${user.username}\n⭐ Points: *${user.points}*\n💠 XP: *${user.total_xp}*\n\n🔗 Code: \`${user.referral_code}\``);
});

bot.command('leaderboard', async (ctx) => {
  const { data: users } = await supabase.from('tg_users').select('username, points').order('points', { ascending: false }).limit(10);
  if (!users || users.length === 0) return ctx.reply('📊 Walang data pa.');
  const medals = ['🥇', '🥈', '🥉'];
  let msg = '🏆 *TOP 10*\n\n';
  users.forEach((u, i) => { msg += `${medals[i] || (i+1)+'.'} @${u.username} — *${u.points}* PTS\n`; });
  await ctx.replyWithMarkdown(msg);
});

bot.command('referral', async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.replyWithMarkdown(`🔗 *Your Referral Code*\n\n\`${user.referral_code}\`\n\n💰 *Earn ₱50 per referral!*`);
});

bot.command('faq', async (ctx) => {
  await ctx.replyWithMarkdown(`❓ *FAQ*\n\n*1. Sign up?* /start.\n*2. Points?* /play.\n*3. Referral?* Share code.\n*4. Withdraw?* Web app.`);
});

bot.action('game_math', async (ctx) => {
  await ctx.answerCbQuery();
  const q = generateMath();
  await updateSession(ctx.from.id, { current_game: 'math', current_question: q, state: 'playing' });
  await ctx.replyWithMarkdown(`🧮 *MATH*\n\n*${q.question}*\n\nI-type ang sagot mo.`);
});

bot.action('game_trivia', async (ctx) => {
  await ctx.answerCbQuery();
  const q = generateTrivia();
  await updateSession(ctx.from.id, { current_game: 'trivia', current_question: q, state: 'playing' });
  const choices = [q.answer, ...q.choices].sort(() => Math.random() - 0.5);
  const keyboard = Markup.inlineKeyboard(choices.map(c => [Markup.button.callback(c, `trivia_${c}`)]));
  await ctx.replyWithMarkdown(`🧠 *TRIVIA*\n\n${q.question}`, keyboard);
});

bot.action(/^trivia_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const answer = ctx.match[1];
  const session = await getSession(ctx.from.id);
  if (!session || session.state !== 'playing') return;
  const q = session.current_question;
  const isCorrect = answer === q.answer;
  const points = isCorrect ? 5 : 0;
  await addPoints(ctx.from.id, points, q.type, isCorrect);
  await updateSession(ctx.from.id, { state: 'idle', current_game: null, current_question: null });
  await ctx.editMessageText(isCorrect ? `✅ *CORRECT!*\n\n⭐ +${points} PTS` : `❌ *WRONG!*\n\nSagot: *${q.answer}*`, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
  const telegramId = ctx.from.id;
  const text = ctx.message.text.trim();
  
  if (text === '🎮 Play Games') {
    const user = await getOrCreateUser(ctx);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🧮 Math', 'game_math')],
      [Markup.button.callback('🧠 Trivia', 'game_trivia')]
    ]);
    return ctx.replyWithMarkdown(`🎮 *Play Games*\n\n⭐ Total: *${user.points}* PTS`, keyboard);
  }
  
  if (text === '🏆 Leaderboard') {
    const { data: users } = await supabase.from('tg_users').select('username, points').order('points', { ascending: false }).limit(10);
    if (!users || users.length === 0) return ctx.reply('📊 Walang data pa.');
    const medals = ['🥇', '🥈', '🥉'];
    let msg = '🏆 *TOP 10*\n\n';
    users.forEach((u, i) => { msg += `${medals[i] || (i+1)+'.'} @${u.username} — *${u.points}* PTS\n`; });
    return ctx.replyWithMarkdown(msg);
  }
  
  if (text === '💰 My Stats') {
    const user = await getOrCreateUser(ctx);
    return ctx.replyWithMarkdown(`📊 *Your Stats*\n\n👤 @${user.username}\n⭐ Points: *${user.points}*\n💠 XP: *${user.total_xp}*\n\n🔗 Code: \`${user.referral_code}\``);
  }
  
  if (text === '🔗 Referral Link') {
    const user = await getOrCreateUser(ctx);
    return ctx.replyWithMarkdown(`🔗 *Your Referral Code*\n\n\`${user.referral_code}\`\n\n💰 *Earn ₱50 per referral!*`);
  }
  
  if (text === '📜 FAQ') {
    return ctx.replyWithMarkdown(`❓ *FAQ*\n\n*1. Sign up?* /start.\n*2. Points?* /play.\n*3. Referral?* Share code.\n*4. Withdraw?* Web app.`);
  }
  
  if (text === '🌐 Open Web App') {
    return ctx.replyWithMarkdown(`🌐 *Open EDA Web App*`, Markup.inlineKeyboard([[Markup.button.url('🌐 Open Web App', WEB_APP_URL)]]));
  }
  
  const session = await getSession(telegramId);
  if (!session || session.state !== 'playing' || !session.current_question) return;
  const q = session.current_question;
  const isCorrect = text.toUpperCase() === String(q.answer).toUpperCase();
  const points = isCorrect ? 5 : 0;
  await addPoints(telegramId, points, q.type, isCorrect);
  await updateSession(telegramId, { state: 'idle', current_game: null, current_question: null });
  await ctx.replyWithMarkdown(isCorrect ? `✅ *CORRECT!*\n\nSagot: *${q.answer}*\n⭐ +${points} PTS` : `❌ *WRONG!*\n\nSagot: *${q.answer}*`);
});

bot.launch().then(() => console.log('🤖 EDA Bot is running...'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
