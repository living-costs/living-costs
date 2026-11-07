/** Store keys: `settings` uses `id`, `overrides` uses `fingerprint`, `transferPairs` uses `key`, and all others use `id`. IDs come from `crypto.randomUUID()`. */

/** @typedef {{headerSignature:string,dateColumn:string,dateFormat:'DD/MM/YYYY',descriptionColumn:string,
 *   typeColumn?:string,accountIdColumn?:string,
 *   amount:{single:string,signFlipped:boolean}|{debit:string,credit:string}}} Mapping */
/** @typedef {{id:string,name:string,currency:string,kind:'bank'|'card'|'savings'|'placeholder',mapping?:Mapping,
 *   identifier?:string,repaymentBucketIds:string[]}} Account */
/** @typedef {{id:string,importId:string,accountId:string,fileName:string,fileHash:string,importedAt:string,
 *   rowCount:number,coversFrom:string,coversTo:string}} Batch */
/** @typedef {{id:string,fingerprint:string,accountId:string,batchId:string,date:string,amountMinor:number,
 *   currency:string,rawText:string,rawType?:string,bucketId:string,flaggedRuleId?:string}} Transaction */
/** @typedef {{id:string,keys:string[],displayName:string,categoryId?:string,stoppedAfter?:string,exampleRawTexts:string[]}} Bucket */
/** @typedef {{id:string,pattern:string,matchType:'keyAmount',amountMinor:number,
 *   expected:{count:number,period:'week'|'month'|'year'},bucketId:string}} Rule */
/** @typedef {'spend'|'income'|'contribution'|'saving'|'transfer'|'ignore'} CategoryKind */
/** @typedef {'fixed'|'variable'|'annual'|'oneoff'} BudgetType */
/** @typedef {{id:string,name:string,kind:CategoryKind,budgetType?:BudgetType,defaultId?:string,position:number}} Category */
/** @typedef {{fingerprint:string,categoryId?:string,splits?:{amountMinor:number,categoryId:string}[],
 *   unusualDismissed?:boolean,flagDecision?:'rule'|'source'}} Override */
/** @typedef {{key:string,fingerprintA:string,fingerprintB:string,status:'confirmed'|'rejected'}} TransferPair */
/** @typedef {{id:'settings',schemaVersion:number,offeredDefaultIds:string[],lastBackupAt?:string,helpDismissed:boolean}} Settings */
/** @typedef {{settings:Settings,accounts:Account[],batches:Batch[],transactions:Transaction[],buckets:Bucket[],
 *   rules:Rule[],categories:Category[],overrides:Map<string,Override>,transferPairs:Map<string,TransferPair>}} State */
/** @typedef {'settings'|'accounts'|'batches'|'transactions'|'buckets'|'rules'|'categories'|'overrides'|'transferPairs'} StoreName */
/** @typedef {{put?:Partial<Record<StoreName,object[]>>,del?:Partial<Record<StoreName,string[]>>}} Changes */

export {};
