const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');

const BOT_TOKEN = process.env.BOT_TOKEN || '9135987312:AAGkmP4rKSg14A8y1Sc4LpIEynNnDLJTHFw';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://oprashmikayasiru_db_user:AMcK5sVpxXr3R7VT@cluster0.ulukf3s.mongodb.net/?retryWrites=true&w=majority';
const ADMIN_ID = String(process.env.ADMIN_ID || '5411921025').trim();
const MAIN_CHANNEL_ID = String(process.env.MAIN_CHANNEL_ID || '-1004309315754').trim();
const BACKUP_CHANNEL_ID = String(process.env.BACKUP_CHANNEL_ID || '-1004306300202').trim();
const VIP_CHANNEL_ID = String(process.env.VIP_CHANNEL_ID || '-1004316350899').trim();
const BOT_USERNAME = process.env.BOT_USERNAME || 'HotLankaVipRefer_bot';

let cachedClient = null;
let indexesCreated = false;

async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 1,
      maxIdleTimeMS: 60000
    });
    await cachedClient.connect();
  }
  const db = cachedClient.db('vip_referral_bot');

  if (!indexesCreated) {
    db.collection('invitees').createIndex({ invitee_id: 1 }, { unique: true }).catch(() => {});
    db.collection('inviters').createIndex({ invite_link: 1 }).catch(() => {});
    indexesCreated = true;
  }

  return db;
}

async function getSettings(db) {
  const col = db.collection('settings');
  let s = await col.findOne({ _id: 'config' });
  if (!s) {
    s = { _id: 'config', target_referrals: 5 };
    await col.insertOne(s);
  }
  return s;
}

const bot = new Telegraf(BOT_TOKEN);

// User /start Command
bot.start(async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const db = await getDb();

  const inviter = await db.collection('inviters').findOne({ _id: userId });

  if (inviter && inviter.vip_claimed) {
    return ctx.reply(
      "🚫 <b>Access Denied!</b>\n\n" +
      "You have already claimed your VIP reward once. Each user is allowed to claim VIP access only once.\n\n" +
      "Further referrals will not be counted.",
      { parse_mode: 'HTML' }
    );
  }

  const welcomeText = 
    `👑 <b>Free VIP Access Referral Program</b> 👑\n\n` +
    `✨ VIP Channel එකට Free Access ලබාගැනීමට පහත පියවර සම්පූර්ණ කරන්න:\n\n` +
    `1️⃣ පහත බොත්තම මගින් Invite Link එක ලබාගන්න. 🔗\n` +
    `2️⃣ එම ලින්ක් එක ඔබේ මිතුරන් වෙත යවන්න. 👥\n` +
    `3️⃣ මිතුරා Main Channel එකට සම්බන්ධ වී Video එකක් Unlock කරගත යුතුය. 🔓🎬\n` +
    `4️⃣ නියමිත මිතුරන් සංඛ්‍යාව සම්පූර්ණ වූ වහාම ඔබට VIP Channel Access හිමිවේ. 🎁`;

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
  const db = await getDb();
  const settings = await getSettings(db);

  let inviter = await db.collection('inviters').findOne({ _id: userId });

  if (inviter && inviter.vip_claimed) {
    await ctx.answerCbQuery();
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
      await ctx.answerCbQuery('Failed to create link. Ensure bot is admin in Main Channel.');
      return ctx.reply("❌ Error generating invite link. Please make sure the bot is an Admin in the Main Channel.");
    }
  }

  const currentCount = inviter ? (inviter.referral_count || 0) : 0;
  const target = settings.target_referrals || 5;

  const msg = 
    `🔗 <b>Your Personal Invite Link:</b>\n` +
    `<code>${inviteLink}</code>\n\n` +
    `📊 <b>Your Progress:</b> <code>${currentCount} / ${target}</code> Completed\n` +
    `🎁 <b>Reward:</b> VIP Channel Access Link`;

  await ctx.answerCbQuery();
  return ctx.reply(msg, { parse_mode: 'HTML' });
});

// Admin Panel Command
bot.command('admin', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return;
  const db = await getDb();
  const settings = await getSettings(db);

  const [totalInviters, pendingCount, verifiedCount, vipClaimedCount] = await Promise.all([
    db.collection('inviters').countDocuments(),
    db.collection('invitees').countDocuments({ is_counted: false }),
    db.collection('invitees').countDocuments({ is_counted: true }),
    db.collection('inviters').countDocuments({ vip_claimed: true })
  ]);

  const panelText = 
    `⚙️ <b>Admin Dashboard</b>\n\n` +
    `👥 <b>Total Inviters:</b> <code>${totalInviters}</code>\n` +
    `⏳ <b>Pending Friends:</b> <code>${pendingCount}</code>\n` +
    `✅ <b>Verified Referrals:</b> <code>${verifiedCount}</code>\n` +
    `👑 <b>VIP Rewards Given:</b> <code>${vipClaimedCount}</code>\n\n` +
    `🎯 <b>Current Target:</b> <code>${settings.target_referrals}</code> Referrals`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎯 Change Target', 'open_target_menu')],
    [Markup.button.callback('🔄 Refresh', 'refresh_admin_panel')]
  ]);

  return ctx.reply(panelText, { parse_mode: 'HTML', ...keyboard });
});

bot.action('refresh_admin_panel', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const db = await getDb();
  const settings = await getSettings(db);

  const [totalInviters, pendingCount, verifiedCount, vipClaimedCount] = await Promise.all([
    db.collection('inviters').countDocuments(),
    db.collection('invitees').countDocuments({ is_counted: false }),
    db.collection('invitees').countDocuments({ is_counted: true }),
    db.collection('inviters').countDocuments({ vip_claimed: true })
  ]);

  const panelText = 
    `⚙️ <b>Admin Dashboard</b>\n\n` +
    `👥 <b>Total Inviters:</b> <code>${totalInviters}</code>\n` +
    `⏳ <b>Pending Friends:</b> <code>${pendingCount}</code>\n` +
    `✅ <b>Verified Referrals:</b> <code>${verifiedCount}</code>\n` +
    `👑 <b>VIP Rewards Given:</b> <code>${vipClaimedCount}</code>\n\n` +
    `🎯 <b>Current Target:</b> <code>${settings.target_referrals}</code> Referrals`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎯 Change Target', 'open_target_menu')],
    [Markup.button.callback('🔄 Refresh', 'refresh_admin_panel')]
  ]);

  await ctx.answerCbQuery('Refreshed!');
  return ctx.editMessageText(panelText, { parse_mode: 'HTML', ...keyboard });
});

bot.action('open_target_menu', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');
  const db = await getDb();
  const settings = await getSettings(db);

  const text = 
    `🎯 <b>Select Referral Target</b>\n\n` +
    `Current Target: <code>${settings.target_referrals}</code>\n` +
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
  const db = await getDb();

  await db.collection('settings').updateOne(
    { _id: 'config' },
    { $set: { target_referrals: target } },
    { upsert: true }
  );

  await ctx.answerCbQuery(`Target set to ${target}!`);
  return ctx.reply(`✅ Referral target updated to <code>${target}</code>!`, { parse_mode: 'HTML' });
});

// Safe Reset Command for Second Account Testing
bot.command('reset', async (ctx) => {
  if (!ctx.from || String(ctx.from.id) !== ADMIN_ID) return;
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply('⚠️ Usage: <code>/reset &lt;USER_ID&gt;</code>', { parse_mode: 'HTML' });
  }

  const targetId = parseInt(parts[1]);
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

    const channelId = String(req.chat.id);
    if (channelId !== MAIN_CHANNEL_ID) return;

    const inviteeId = req.from.id;
    const inviteLink = req.invite_link ? req.invite_link.invite_link : null;
    if (!inviteLink) return;

    const db = await getDb();

    // Check if link belongs to an inviter
    const inviter = await db.collection('inviters').findOne({ invite_link: inviteLink });
    if (!inviter) return;

    // Block Self-Referral
    if (inviter._id === inviteeId) return;

    // Do not count if Inviter has already claimed VIP
    if (inviter.vip_claimed) return;

    // Insert only if invitee does not already exist
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

    const channelId = String(cm.chat.id);
    if (channelId !== BACKUP_CHANNEL_ID) return;

    const newStatus = cm.new_chat_member ? cm.new_chat_member.status : null;
    const oldStatus = cm.old_chat_member ? cm.old_chat_member.status : null;

    // Triggers only when joining Backup Channel
    if (newStatus === 'member' && ['left', 'kicked'].includes(oldStatus)) {
      const inviteeId = cm.new_chat_member.user.id;
      const db = await getDb();

      // Atomic Lock to verify and prevent double counting
      const updateResult = await db.collection('invitees').findOneAndUpdate(
        { invitee_id: inviteeId, is_counted: false },
        { $set: { backup_joined: true, is_counted: true, verified_at: new Date() } },
        { returnDocument: 'after' }
      );

      const record = updateResult && updateResult.value ? updateResult.value : updateResult;
      if (!record || !record.inviter_id) return;

      const inviterId = record.inviter_id;
      const settings = await getSettings(db);
      const target = settings.target_referrals || 5;

      // Increment inviter count
      const inviterUpdate = await db.collection('inviters').findOneAndUpdate(
        { _id: inviterId },
        { $inc: { referral_count: 1 } },
        { returnDocument: 'after' }
      );

      const updatedInviter = inviterUpdate && inviterUpdate.value ? inviterUpdate.value : inviterUpdate;
      if (!updatedInviter) return;

      const currentCount = updatedInviter.referral_count || 0;

      // Check if target is reached and not already claimed
      if (currentCount >= target && !updatedInviter.vip_claimed) {
        // Lock VIP claim
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
              `<code>${vipLinkObj.invite_link}</code>\n\n` +
              `⚠️ <i>Note: Do not share it with others!</i>`;

            await ctx.telegram.sendMessage(inviterId, vipMsg, { parse_mode: 'HTML' });
          } catch (vipErr) {
            console.error('Failed to create VIP invite link:', vipErr);
          }
        }
      } else if (!updatedInviter.vip_claimed) {
        // Referral step progress notification
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
      if (req.body && typeof req.body === 'object') {
        // Background async processing without blocking Vercel
        bot.handleUpdate(req.body).catch(err => console.error('Update handling error:', err));
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }
    return res.status(200).send('OK');
  }
  return res.status(200).send('VIP Referral Bot is Running Active!');
};
