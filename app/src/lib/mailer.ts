export type Email = { to: string; subject: string; text: string };

/** Messages "sent" in development and tests. Production email (Amazon SES, Canada) is set up with the release item. */
export const outbox: Email[] = [];

export async function sendEmail(email: Email): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.EMAIL_TRANSPORT !== "log") {
    throw new Error("No email transport configured for production yet");
  }
  outbox.push(email);
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    console.log(`\n[email] to ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
  }
}
