const { ResendAdapter } = require('./emailAdapters/resend');
const { ConsoleAdapter } = require('./emailAdapters/console');

class EmailService {
  constructor(env = process.env) {
    const provider = (env.EMAIL_PROVIDER || 'resend').toLowerCase();
    const from = env.EMAIL_FROM || 'onboarding@resend.dev';

    if (provider === 'resend' && env.RESEND_API_KEY) {
      this.adapter = new ResendAdapter({ apiKey: env.RESEND_API_KEY, from });
      this.providerName = 'resend';
    } else {
      if (provider === 'resend' && !env.RESEND_API_KEY) {
        console.warn('[email] RESEND_API_KEY not set — falling back to console adapter; verification codes will be printed to stdout');
      }
      this.adapter = new ConsoleAdapter();
      this.providerName = 'console';
    }
  }

  async sendVerificationCode(email, code) {
    return this.adapter.sendEmail({
      to: email,
      subject: 'Your StudyXP verification code',
      text: `Your StudyXP verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request it, ignore this email.`,
    });
  }
}

module.exports = { EmailService };
