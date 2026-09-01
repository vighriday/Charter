/**
 * What each tool does, said the way a person would say it.
 *
 * WHY THIS EXISTS
 *
 * A tool is one specific thing Charter is allowed to do. Every one of them has a
 * short name in the code, and those names are exactly right for code and useless
 * to anybody else. "register_address" is unambiguous to a program and tells a
 * first-time reader nothing about what happened.
 *
 * The website, the finished document and the command line all have to say what
 * happened, and all three should say it the same way. So the sentence lives here,
 * once, and everything that needs it reads it from here. Two lists would drift,
 * and a drifted list still reads as though it were right.
 *
 * WHAT THESE SENTENCES ARE FOR
 *
 * Each one finishes the phrase "in this step it may". They are written for
 * somebody who has never seen this project, so no phrase names a company, a file
 * format, or another part of the system. If a phrase needs a word the reader has
 * to look up, it is the wrong phrase.
 *
 * A tool with no sentence here fails the build. That rule is what keeps this file
 * honest: a tool added later cannot quietly appear in front of a reader under its
 * code name, because the build stops until somebody writes the sentence.
 */

/** Every tool, and what it does, in words anybody can read. */
export const WHAT_TOOLS_DO: Readonly<Record<string, string>> = {
  ask_question: 'ask you a question and wait for your answer',
  record_fact: 'write down something you told it',
  request_spend_permission: 'ask you for permission to spend money',
  search_web: 'search the web',
  compare_names: 'compare two business names',
  check_address: 'check whether a web address is free',
  register_address: 'buy a web address',
  set_address_records: 'point a web address at the website',
  list_address_records: 'read back where a web address points',
  record_agreement_choice: 'write down a decision about the contract',
  draft_agreement: 'write the contract',
  read_identity_document: 'read an ID document',
  assemble_pack: 'join everything into one file and stamp it',
  draw_storefront: 'draw the shop picture',
  publish_site: 'put the website online',
}

/**
 * What one tool does, or its own name if nobody has written that down yet.
 *
 * Falls back to the name rather than to an empty string, because a row that says
 * "register_address" is worse than the alternative and a row that says nothing at
 * all is worse than both.
 */
export function whatToolDoes(name: string): string {
  return WHAT_TOOLS_DO[name] ?? name
}
