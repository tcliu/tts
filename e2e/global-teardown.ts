import Database from 'better-sqlite3';
import path from 'node:path';

// Deletes this run's throwaway accounts (`e2e_smoke_<timestamp>`); documents
// cascade via the user_documents foreign key, orphans are swept as backup.
async function globalTeardown() {
	const db = new Database(path.resolve('.data', 'dev.sqlite'));
	try {
		db.pragma('foreign_keys = ON');
		const removed = db
			.prepare("delete from users where username like 'e2e\\_smoke\\_%' escape '\\'")
			.run();
		db.prepare('delete from user_documents where user_id not in (select id from users)').run();
		console.log(`[e2e-teardown] removed ${removed.changes} smoke user(s)`);
	} finally {
		db.close();
	}
}

export default globalTeardown;
