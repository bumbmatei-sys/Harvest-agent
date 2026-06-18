import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { generateAccessCode } from '@/lib/ai-utils';

/**
 * POST /api/ai-assistant/verify
 * Verifies an AI assistant access code and binds a Telegram user to a tenant.
 * Called by the Telegram bot when a user provides their access code.
 * 
 * Body: { code: string, telegramUserId: string, telegramUsername?: string }
 * Header: x-bot-secret must match TELEGRAM_BOT_SECRET env var
 */
export async function POST(request: NextRequest) {
  try {
    // Verify bot secret — ensures caller is the actual Telegram bot
    const botSecret = process.env.TELEGRAM_BOT_SECRET;
    const providedSecret = request.headers.get('x-bot-secret');
    if (!botSecret || providedSecret !== botSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { code, telegramUserId, telegramUsername } = await request.json();

    if (!code || !telegramUserId) {
      return NextResponse.json({ error: 'Missing code or telegramUserId' }, { status: 400 });
    }

    // Find tenant with this access code
    const tenantsSnap = await adminDb.collection('tenants')
      .where('addOnAiAssistantCode', '==', code.toUpperCase())
      .limit(1)
      .get();

    if (tenantsSnap.empty) {
      return NextResponse.json({ valid: false, error: 'Invalid access code' }, { status: 404 });
    }

    const tenantDoc = tenantsSnap.docs[0];
    const tenantData = tenantDoc.data();
    const tenantId = tenantDoc.id;

    // Check subscription is active
    if (!tenantData.addOnAiAssistant) {
      return NextResponse.json({ valid: false, error: 'AI Assistant subscription not active' }, { status: 403 });
    }

    // Check if this Telegram user is already bound to a tenant
    const existingBindingSnap = await adminDb.collection('ai_assistant_bindings')
      .where('telegramUserId', '==', telegramUserId)
      .limit(1)
      .get();

    if (!existingBindingSnap.empty) {
      const existingBinding = existingBindingSnap.docs[0].data();
      if (existingBinding.tenantId === tenantId) {
        // Already bound to this tenant — valid
        return NextResponse.json({
          valid: true,
          tenantId,
          tenantName: tenantData.name,
          telegramUserId,
        });
      }
      // Bound to a different tenant — reject
      return NextResponse.json({
        valid: false,
        error: 'This Telegram account is already bound to another organization',
      }, { status: 403 });
    }

    // Create binding
    await adminDb.collection('ai_assistant_bindings').add({
      tenantId,
      telegramUserId,
      telegramUsername: telegramUsername || null,
      code: code.toUpperCase(),
      boundAt: new Date().toISOString(),
    });

    return NextResponse.json({
      valid: true,
      tenantId,
      tenantName: tenantData.name,
      telegramUserId,
    });
  } catch (error: any) {
    console.error('AI assistant verify error:', error);
    return NextResponse.json({ error: 'Failed to verify access code' }, { status: 500 });
  }
}

/**
 * POST /api/ai-assistant/check
 * Quick subscription status check for the bot on every message.
 * Requires bot secret header.
 * 
 * Body: { telegramUserId: string }
 */
export async function PUT(request: NextRequest) {
  try {
    // Verify bot secret
    const botSecret = process.env.TELEGRAM_BOT_SECRET;
    const providedSecret = request.headers.get('x-bot-secret');
    if (!botSecret || providedSecret !== botSecret) {
      return NextResponse.json({ active: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { telegramUserId } = await request.json();

    if (!telegramUserId) {
      return NextResponse.json({ active: false, error: 'Missing telegramUserId' }, { status: 400 });
    }

    // Find binding
    const bindingSnap = await adminDb.collection('ai_assistant_bindings')
      .where('telegramUserId', '==', telegramUserId)
      .limit(1)
      .get();

    if (bindingSnap.empty) {
      return NextResponse.json({ active: false, error: 'Not bound to any organization' });
    }

    const binding = bindingSnap.docs[0].data();
    const tenantDoc = await adminDb.collection('tenants').doc(binding.tenantId).get();

    if (!tenantDoc.exists) {
      return NextResponse.json({ active: false, error: 'Organization not found' });
    }

    const tenantData = tenantDoc.data();
    const active = !!tenantData?.addOnAiAssistant;

    return NextResponse.json({
      active,
      tenantId: binding.tenantId,
      tenantName: tenantData?.name,
    });
  } catch (error: any) {
    console.error('AI assistant check error:', error);
    return NextResponse.json({ active: false, error: 'Failed to check subscription' }, { status: 500 });
  }
}

// generateAccessCode is now imported from @/lib/ai-utils
