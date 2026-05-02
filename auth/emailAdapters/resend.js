const { Resend } = require('resend');

class ResendAdapter {
  constructor({ apiKey, from }) {
    if (!apiKey) throw new Error('ResendAdapter requires apiKey');
    this.client = new Resend(apiKey);
    this.from = from || 'onboarding@resend.dev';
  }

  async sendEmail({ to, subject, text }) {
    try {
      console.log('[resend] sending — from:', this.from, '| to:', to, '| subject:', subject);
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to,
        subject,
        text,
      });
      if (error) {
        console.error('[resend] send failed:', JSON.stringify(error));
        throw new Error(`Resend error: ${error.message || JSON.stringify(error)}`);
      }
      console.log(`[resend] sent to ${to} (id: ${data?.id})`);
    } catch (err) {
      console.error('[resend] exception during send:', err);
      throw err;
    }
  }
}

module.exports = { ResendAdapter };
