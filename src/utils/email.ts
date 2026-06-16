/**
 * Email notification utility.
 * Sends emails via the /api/send-email route.
 */

const APP_URL = typeof window !== 'undefined' 
  ? window.location.origin 
  : (process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app');

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const resp = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return resp.ok;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

// ─── Email Templates ────────────────────────────────────────────

export function welcomeEmail(name: string, ministryName: string): EmailOptions & { to: string } {
  return {
    to: '', // Set by caller
    subject: `Welcome to Harvest, ${ministryName}!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0b1121;">Welcome to Harvest! 🌾</h1>
        <p>Hi ${name},</p>
        <p>Your ministry <strong>${ministryName}</strong> is now set up on Harvest.</p>
        <p>You can access your admin dashboard to:</p>
        <ul>
          <li>Create and manage courses</li>
          <li>Write blog posts</li>
          <li>Manage your community feed</li>
          <li>Set up your AI knowledge base</li>
        </ul>
        <p>If you need help, just reply to this email.</p>
        <p>Blessings,<br>The Harvest Team</p>
      </div>
    `,
  };
}

export function contactFormNotification(
  adminEmail: string,
  submitterName: string,
  submitterEmail: string,
  message: string,
  ministryName: string
): EmailOptions {
  return {
    to: adminEmail,
    subject: `New contact form submission from ${submitterName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0b1121;">New Contact Form Submission</h2>
        <p><strong>From:</strong> ${submitterName} (${submitterEmail})</p>
        <p><strong>Ministry:</strong> ${ministryName}</p>
        <p><strong>Message:</strong></p>
        <blockquote style="border-left: 3px solid #D4AF37; padding-left: 16px; color: #555;">
          ${message}
        </blockquote>
        <p><a href="${APP_URL}" style="color: #D4AF37;">View in Dashboard →</a></p>
      </div>
    `,
  };
}

export function planChangeEmail(
  email: string,
  ministryName: string,
  oldPlan: string,
  newPlan: string
): EmailOptions {
  return {
    to: email,
    subject: `Plan changed: ${ministryName} is now on ${newPlan}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0b1121;">Plan Updated ✅</h2>
        <p>Hi,</p>
        <p><strong>${ministryName}</strong> has been upgraded from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>.</p>
        <p>Your new features are now active. Check your settings to explore them.</p>
        <p>Blessings,<br>The Harvest Team</p>
      </div>
    `,
  };
}

export function newPostNotification(
  subscriberEmail: string,
  postTitle: string,
  ministryName: string
): EmailOptions {
  return {
    to: subscriberEmail,
    subject: `New post: ${postTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0b1121;">New Post from ${ministryName}</h2>
        <p><strong>${postTitle}</strong></p>
        <p><a href="${APP_URL}" style="color: #D4AF37;">Read More →</a></p>
      </div>
    `,
  };
}

export { sendEmail };
