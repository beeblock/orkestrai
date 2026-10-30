import { isolateSqliteTransactions } from '$lib/database/sqlite-transactions.js';
import { installCodeGraphStorage, routeCodeGraphQueries } from '$lib/database/code-graph-storage.js';

installCodeGraphStorage();
isolateSqliteTransactions();
routeCodeGraphQueries();
