// Changing an account's kind.

/** @import {State, Changes} from './types.js' */

/**
 * Set a bank, card or savings account's kind. Nothing changes for a placeholder, an unknown
 * account, or a kind it already has.
 * @param {State} state
 * @param {string} accountId
 * @param {'bank'|'card'|'savings'} kind
 * @returns {Changes}
 */
export function setAccountKind(state, accountId, kind) {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account || account.kind === 'placeholder' || account.kind === kind) return {};
  return { put: { accounts: [{ ...account, kind }] } };
}
