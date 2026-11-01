const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');

const BOT_TOKEN = process.env.BOT_TOKEN || '9135987312:AAGkmP4rKSg14A8y1Sc4LpIEynNnDLJTHFw';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://oprashmikayasiru_db_user:AMcK5sVpxXr3R7VT@cluster0.ulukf3s.mongodb.net/vip_referral_bot?retryWrites=true&w=majority';
const ADMIN_ID = String(process.env.ADMIN_ID || '5411921025').trim();
const MAIN_CHANNEL_ID = String(process.env.MAIN_CHANNEL_ID || '-1004309315754').trim();
const BACKUP_CHANNEL_ID = String(process.env.BACKUP_CHANNEL_ID || '-1004306300202').trim();
const VIP_CHANNEL_ID = String(process.env.VIP_CHANNEL_ID || '-1004316350899').trim();

let cachedDb = null;
let commandsRegistered = false;

async function getDb() {
  if (cachedDb) return cachedDb;
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 60000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000
  });
  await client.connect();
  cachedDb = client.db('vip_referral_bot');
  return cachedDb;
}

// In-memory cache for fast target lookup
let cachedTarget = 5;
let targetLastFetched = 0;

async function getTarget(db) {
  const now = Date.now();
  if (now - targetLastFetched < 30000) {
    return cachedTarget;
  }
  const s = await db.collection('settings').findOne({ _id: 'config' });
  if (s && s.target_referrals) {
    cachedTarget = s.target_referrals;
  }
  targetLastFetched = now;
  return cachedTarget;
}

const bot = new Telegraf(BOT_TOKEN);

async function ensureCommandsRegistered() {
  if (commandsRegistered) return;
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start Bot & Get Link' }
    ], { scope: { type: 'default' } });

    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start Bot' },
      { command: 'admin', description: 'Admin Panel' },
      { command: 'reset', description: 'Reset Test Account' },
      { command: 'resetme', description: 'Reset Inviter Status' }
    ], { scope: { type: 'chat', chat_id: ADMIN_ID } });

    commandsRegistered = true;
  } catch (err) {
    console.error('Error setting bot commands:', err);
  }
}

// User /start Command
bot.start(async (ctx) => {
  const welcomeText = 
    `👑 <b>VIP REWARDS PROGRAM</b> 👑\n\n` +
    `යාලුවන්ට Share කරලා <b>VIP Channel Access</b> නොමිලේම දිනාගන්න! 🎁\n\n` +
    `<b>Steps:</b>\n` +
    `🔹 පහත Button එකෙන් ඔබේ Link එක ගන්න\n` +
    `🔹 යාලුවන්ට යවන්න (Join Main Channel + Video Unlock)\n` +
    `🔹 Target එක පිරුණු ගමන් Instant VIP Link !`;

  return ctx.reply(welcomeText, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔗 Get Invite Link', 'get_invite_link')]
    ])
  });
});

// Button: Get Invite Link
bot.action('get_invite_link', async (ctx) => {
  if (!ctx.from) return ctx.answerCbQuery();
  const userId = ctx.from.id;
  await ctx.answerCbQuery('Processing...');

  const db = await getDb();
  const [inviter, target] = await Promise.all([
    db.collection('inviters').findOne({ _id: userId }),
    getTarget(db)
  ]);

  if (inviter && inviter.vip_claimed) {
    return ctx.reply(
      "🚫 <b>Access Denied!</b>\n\nYou have already claimed your VIP reward once.",
      { parse_mode: 'HTML' }
    );
  }

  let inviteLink = inviter ? inviter.invite_link : null;

  if (!inviteLink) {
    try {
      const linkObj = await ctx.telegram.createChatInviteLink(MAIN_CHANNEL_ID, {
        name: `ref_${userId}`,
        creates_join_request: true
      });
      inviteLink = linkObj.invite_link;

      await db.collection('inviters').updateOne(
        { _id: userId },
        {
          $set: {
            invite_link: inviteLink,
            first_name: ctx.from.first_name || '',
            username: ctx.from.username || null,
            updated_at: new Date()
          },
          $setOnInsert: {
            referral_count: 0,
            vip_claimed: false,
            created_at: new Date()
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('Invite link generation error:', err);
      return ctx.reply("❌ Error generating invite link. Please make sure the bot is an Admin in the Main Channel.");
    }
  }

  const currentCount = inviter ? (inviter.referral_count || 0) : 0;
  // ලින්ක් එක යටට වැටෙන සේ සම්පූර්ණ Text එක සකස් කිරීම
  const fullShareText = `🔥 Hot Lanka Exclusive Videos බලන්න!\nJoin වෙන්න පහත ලින්ක් එක ක්ලික් කරන්න 👇\n\n${inviteLink}`;
  const shareUrl = `https://t.me/share/url?text=${encodeURIComponent(fullShareText)}`;
  
  const msg = 
    `🔗 <b>Your Personal Invite Link:</b>\n` +
    `${inviteLink}\n\n` +
    `📊 <b>Your Progress:</b> <code>${currentCount} / ${target}</code> Completed\n\n` +
    `🎁 <b>Reward:</b> VIP Channel Access Link`;

  return ctx.reply(msg, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    disable_web_page_preview: true,
    ...Markup.inlineKeyboard([
      [Markup.button.url('🚀 Share with Friends', shareUrl)]
    ])
  });
});

// Admin Panel Command
bot.command('admin', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return;
  const db = await getDb();

  const [totalInviters, pendingCount, verifiedCount, vipClaimedCount, target] = await Promise.all([
    db.collection('inviters').estimatedDocumentCount(),
    db.collection('invitees').countDocuments({ is_counted: false }),
    db.collection('invitees').countDocuments({ is_counted: true }),
    db.collection('inviters').countDocuments({ vip_claimed: true }),
    getTarget(db)
  ]);

  const panelText = 
    `⚙️ <b>Admin Dashboard</b>\n\n` +
    `👥 <b>Total Inviters:</b> <code>${totalInviters}</code>\n` +
    `⏳ <b>Pending Friends:</b> <code>${pendingCount}</code>\n` +
    `✅ <b>Verified Referrals:</b> <code>${verifiedCount}</code>\n` +
    `👑 <b>VIP Rewards Given:</b> <code>${vipClaimedCount}</code>\n\n` +
    `🎯 <b>Current Target:</b> <code>${target}</code> Referrals`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎯 Change Target', 'open_target_menu')],
    [Markup.button.callback('🔄 Refresh', 'refresh_admin_panel')]
  ]);

  return ctx.reply(panelText, { parse_mode: 'HTML', ...keyboard });
});

bot.action('refresh_admin_panel', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  await ctx.answerCbQuery('Refreshing...');
  const db = await getDb();

  const [totalInviters, pendingCount, verifiedCount, vipClaimedCount, target] = await Promise.all([
    db.collection('inviters').estimatedDocumentCount(),
    db.collection('invitees').countDocuments({ is_counted: false }),
    db.collection('invitees').countDocuments({ is_counted: true }),
    db.collection('inviters').countDocuments({ vip_claimed: true }),
    getTarget(db)
  ]);

  const panelText = 
    `⚙️ <b>Admin Dashboard</b>\n\n` +
    `👥 <b>Total Inviters:</b> <code>${totalInviters}</code>\n` +
    `⏳ <b>Pending Friends:</b> <code>${pendingCount}</code>\n` +
    `✅ <b>Verified Referrals:</b> <code>${verifiedCount}</code>\n` +
    `👑 <b>VIP Rewards Given:</b> <code>${vipClaimedCount}</code>\n\n` +
    `🎯 <b>Current Target:</b> <code>${target}</code> Referrals`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎯 Change Target', 'open_target_menu')],
    [Markup.button.callback('🔄 Refresh', 'refresh_admin_panel')]
  ]);

  return ctx.editMessageText(panelText, { parse_mode: 'HTML', ...keyboard });
});

bot.action('open_target_menu', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const db = await getDb();
  const target = await getTarget(db);

  const text = 
    `🎯 <b>Select Referral Target</b>\n\n` +
    `Current Target: <code>${target}</code>\n` +
    `Choose how many valid referrals are needed for VIP access:`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('1 (Test)', 'set_target_1'),
      Markup.button.callback('5', 'set_target_5')
    ],
    [
      Markup.button.callback('7', 'set_target_7'),
      Markup.button.callback('10', 'set_target_10')
    ],
    [
      Markup.button.callback('⬅️ Back', 'refresh_admin_panel')
    ]
  ]);

  await ctx.answerCbQuery();
  return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
});

bot.action(/^set_target_(\d+)$/, async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const target = parseInt(ctx.match[1]);
  cachedTarget = target;
  targetLastFetched = Date.now();

  const db = await getDb();
  await db.collection('settings').updateOne(
    { _id: 'config' },
    { $set: { target_referrals: target } },
    { upsert: true }
  );

  await ctx.answerCbQuery(`Target set to ${target}!`);
  return ctx.reply(`✅ Referral target updated to <code>${target}</code>!`, { parse_mode: 'HTML' });
});

// Admin Self-Reset Command
bot.command('resetme', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return;
  const db = await getDb();

  await db.collection('inviters').updateOne(
    { _id: ctx.from.id },
    { $set: { referral_count: 0, vip_claimed: false } }
  );

  return ctx.reply('✅ <b>Your Inviter Profile has been Reset!</b>\n\nReferral count set to 0 and VIP lock removed. You can now test again.', { parse_mode: 'HTML' });
});

// Safe Reset Command (Default: 8226533559)
bot.command('reset', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return;
  const parts = ctx.message.text.trim().split(/\s+/);
  
  // Default to 8226533559 if no ID is specified
  const targetId = parts.length >= 2 ? parseInt(parts[1]) : 8226533559;

  if (isNaN(targetId)) {
    return ctx.reply('❌ Invalid User ID.');
  }

  const db = await getDb();
  const invitee = await db.collection('invitees').findOne({ invitee_id: targetId });

  if (!invitee) {
    return ctx.reply(`❌ User <code>${targetId}</code> not found in database records.`, { parse_mode: 'HTML' });
  }

  const statusText = invitee.is_counted ? 'Verified (Counted)' : 'Pending';
  const confirmText = 
    `⚠️ <b>Confirm User Reset</b>\n\n` +
    `Are you sure you want to delete this user from database?\n\n` +
    `• <b>User ID:</b> <code>${targetId}</code>\n` +
    `• <b>Invited By:</b> <code>${invitee.inviter_id}</code>\n` +
    `• <b>Status:</b> ${statusText}\n\n` +
    `This action will remove the record and deduct 1 point from the inviter.`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🗑 Yes, Delete', `confirm_del_${targetId}`),
      Markup.button.callback('❌ Cancel', 'cancel_del')
    ]
  ]);

  return ctx.reply(confirmText, { parse_mode: 'HTML', ...keyboard });
});

bot.action(/^confirm_del_(\d+)$/, async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const targetId = parseInt(ctx.match[1]);
  const db = await getDb();

  const invitee = await db.collection('invitees').findOne({ invitee_id: targetId });
  if (!invitee) {
    await ctx.answerCbQuery('User not found.');
    return ctx.editMessageText('❌ User already deleted.');
  }

  if (invitee.is_counted && invitee.inviter_id) {
    await db.collection('inviters').updateOne(
      { _id: invitee.inviter_id, referral_count: { $gt: 0 } },
      { $inc: { referral_count: -1 } }
    );
  }

  await db.collection('invitees').deleteOne({ invitee_id: targetId });

  await ctx.answerCbQuery('User reset successfully!');
  return ctx.editMessageText(
    `✅ <b>User Reset Successful!</b>\n\n` +
    `User <code>${targetId}</code> has been removed from database. You can now use this account to test again.`,
    { parse_mode: 'HTML' }
  );
});

bot.action('cancel_del', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  await ctx.answerCbQuery('Cancelled.');
  return ctx.editMessageText('🚫 Reset operation cancelled. No changes were made.');
});

// Webhook Event: Chat Join Request (Tracking Point 1)
bot.on('chat_join_request', async (ctx) => {
  try {
    const req = ctx.chatJoinRequest;
    if (!req) return;

    if (String(req.chat.id) !== MAIN_CHANNEL_ID) return;

    const inviteeId = req.from.id;
    const inviteLink = req.invite_link ? req.invite_link.invite_link : null;
    if (!inviteLink) return;

    const db = await getDb();
    const inviter = await db.collection('inviters').findOne({ invite_link: inviteLink });
    if (!inviter || inviter._id === inviteeId || inviter.vip_claimed) return;

    await db.collection('invitees').updateOne(
      { invitee_id: inviteeId },
      {
        $setOnInsert: {
          invitee_id: inviteeId,
          inviter_id: inviter._id,
          main_joined: true,
          backup_joined: false,
          is_counted: false,
          created_at: new Date()
        }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('chat_join_request handler error:', err);
  }
});

// Webhook Event: Chat Member Status Change (Tracking Point 2)
bot.on('chat_member', async (ctx) => {
  try {
    const cm = ctx.chatMember;
    if (!cm) return;

    if (String(cm.chat.id) !== BACKUP_CHANNEL_ID) return;

    const newStatus = cm.new_chat_member ? cm.new_chat_member.status : null;
    const oldStatus = cm.old_chat_member ? cm.old_chat_member.status : null;

    if (newStatus === 'member' && ['left', 'kicked'].includes(oldStatus)) {
      const inviteeId = cm.new_chat_member.user.id;
      const db = await getDb();

      const updateResult = await db.collection('invitees').findOneAndUpdate(
        { invitee_id: inviteeId, is_counted: false },
        { $set: { backup_joined: true, is_counted: true, verified_at: new Date() } },
        { returnDocument: 'after' }
      );

      const record = updateResult && updateResult.value ? updateResult.value : updateResult;
      if (!record || !record.inviter_id) return;

      const inviterId = record.inviter_id;
      const target = await getTarget(db);

      const inviterUpdate = await db.collection('inviters').findOneAndUpdate(
        { _id: inviterId },
        { $inc: { referral_count: 1 } },
        { returnDocument: 'after' }
      );

      const updatedInviter = inviterUpdate && inviterUpdate.value ? inviterUpdate.value : inviterUpdate;
      if (!updatedInviter) return;

      const currentCount = updatedInviter.referral_count || 0;

      if (currentCount >= target && !updatedInviter.vip_claimed) {
        const claimLock = await db.collection('inviters').findOneAndUpdate(
          { _id: inviterId, vip_claimed: false },
          { $set: { vip_claimed: true, vip_claimed_at: new Date() } }
        );

        if (claimLock && (claimLock.value || claimLock._id)) {
          try {
            const vipLinkObj = await ctx.telegram.createChatInviteLink(VIP_CHANNEL_ID, {
              name: `VIP_Claim_${inviterId}`,
              member_limit: 1
            });

            const vipMsg = 
              `👑 <b>Congratulations!</b>\n\n` +
              `You have successfully reached the target of <code>${target}</code> referrals!\n\n` +
              `🔗 <b>Your VIP Channel Link:</b>\n` +
              `${vipLinkObj.invite_link}\n\n` +
              `⚠️ <i>Note: Do not share it with others!</i>`;

            await ctx.telegram.sendMessage(inviterId, vipMsg, {
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true },
              disable_web_page_preview: true,
              ...Markup.inlineKeyboard([
                [Markup.button.url('👑 Join VIP Channel', vipLinkObj.invite_link)]
              ])
            });
          } catch (vipErr) {
            console.error('Failed to create VIP invite link:', vipErr);
          }
        }
      } else if (!updatedInviter.vip_claimed) {
        const progressMsg = 
          `✅ <b>New Referral Completed!</b>\n\n` +
          `A friend has joined using your link and unlocked a video.\n\n` +
          `📊 <b>Current Progress:</b> <code>${currentCount} / ${target}</code>\n` +
          `Keep going to unlock your VIP link!`;

        await ctx.telegram.sendMessage(inviterId, progressMsg, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('chat_member handler error:', err);
  }
});

// Vercel Serverless Function Handler
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        body = JSON.parse(body);
      }
      if (body) {
        ensureCommandsRegistered().catch(() => {});
        await bot.handleUpdate(body);
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
    return res.status(200).send('OK');
  }
  return res.status(200).send('VIP Referral Bot is Running Active!');
};
