const { Resend } = require('resend');

class ResendAdapter {
  constructor({ apiKey, from }) {
    if (!apiKey) throw new Error('ResendAdapter requires apiKey');
    this.client = new Resend(apiKey);
    this.from = from || 'onboarding@resend.dev';
  }

  async sendEmail({ to, subject, text }) {
    await this.client.emails.send({
      from: this.from,
      to,
      subject,
      text,
    });
  }
}

module.exports = { ResendAdapter };
