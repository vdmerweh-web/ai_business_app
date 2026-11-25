// Transactional mail is STUBBED: nothing is sent. Messages are stored in mail_outbox
// so we can see what would go out. A real sending service (Brevo, Postmark or Amazon SES)
// will be plugged in here once Hannes picks one (plan: needs list item 12).
import {db} from './db.js';
export function stubMail({clientId, siteId, copy, to = null, subject, body}) {
  db.prepare("insert into mail_outbox(client_id,site_id,copy,to_addr,subject,body,status) values(?,?,?,?,?,?,'stubbed')")
    .run(clientId || null, siteId || null, copy || null, to, String(subject).slice(0, 200), String(body).slice(0, 2000));
}
