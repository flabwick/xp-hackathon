class ConsoleAdapter {
  constructor() {}

  async sendEmail({ to, subject, text }) {
    console.log('────────── [email:console] ──────────');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    console.log('─────────────────────────────────────');
  }
}

module.exports = { ConsoleAdapter };
