# What this agent can do

**This file is generated from the code that runs.** It is not written by hand and
it is not kept in step by anybody remembering. `npm run catalogue:check` fails the
build if this file and the code disagree, so a tool cannot be added without this
file changing in the same commit.

The reason it is generated is worth stating. A hand-written list is right on the
day it is written and wrong the first time a tool is added, and the gap is
invisible — the document still reads as though it were complete. One vendor whose
service this project uses publishes three different counts of their own tool set
across their brief, their readme and their blog, and none of the three matches the
number in their code. We counted from the source and found a fourth. **Checkable
beats quoted.**

The interesting part of this list is the end of it: the things that are not on it,
and cannot be reached from anything that is.

```
What this agent can do, and in which stage

Generated from the code that runs. Each stage sends the model exactly the tools
listed under it and nothing else, so a tool absent from a stage is not forbidden
there — it does not exist there.

1. Understand the business
   You describe the business in your own words. Charter asks about anything it still needs, including permission to spend a set amount on the web address.
   ask_question
      Puts a question on the screen for the owners to answer. Changes nothing, costs nothing, and reaches no outside service. The stage cannot finish while any question is still unanswered, so the agent cannot decide it has heard enough while somebody is still typing.
   record_fact
      Adds one entry to the record. Nothing is stored anywhere else, so what Charter knows is always the record read forward — which is why a run survives a crash or a closed browser tab with nothing lost.
   request_spend_permission
      Puts a request on the screen. It cannot give permission — there is no tool for that anywhere in Charter. A permission is written to the record only when a person grants it in their browser, along a path the model is not on. So a model that decided to authorise itself has nothing to call.

2. Check the name is free
   Look for businesses already trading under this name, and work out whether the new one is clear of them. Whether two names are too close is decided by fixed rules, not by guesswork.
   search_web
      One tool with two search companies behind it. Which one answered goes into the record but is never returned here, because a model that can see which service replied starts reasoning about the services instead of the business. Results are cached by the exact query text, because the main service allows 250 searches a month and one run uses several.
   compare_names
      The decision is made in plain code: fold the accents, lowercase it, remove the company ending and the punctuation, join up initials, then compare. Anything close goes to a person rather than being guessed at. Reproducible on anyone's machine, free to run, and a complete answer to somebody who asks how it works. The model chooses what to compare and writes the explanation afterwards; it does not reach the verdict.
   record_fact
      Adds one entry to the record. Nothing is stored anywhere else, so what Charter knows is always the record read forward — which is why a run survives a crash or a closed browser tab with nothing lost.

3. Get the web address
   See whether the web address is available, and buy it only if a person has already agreed to a price that covers it.
   check_address
      Asks the registrar a question. Costs nothing, registers nothing, and can be run as often as needed. This is the tool that finds out the price the permission then has to cover.
   register_address  [spends money, cannot be undone]
      The one tool in the first three stages that changes something in the world and cannot be taken back. Before it runs, code reads the record for a permission a person granted and checks the price falls inside it. No permission, or a price above what is left, and nothing is called — the registrar is not contacted at all. The check is deliberately outside the registrar code, so that replacing the registrar cannot take the rule with it.
   set_address_records
      Registering a name and pointing it somewhere are two different acts, and a name with no records is a name nobody can reach. So this is a separate tool from the one that spends money, it costs nothing, and it refuses outright on a name this case has not registered. Pointing a name somebody else holds is not a mistake worth making once.
   list_address_records
      Writing returns success, and success means the request was accepted rather than that anything was stored. Reading back is the only way to find out what the registrar actually holds, and it is the difference between "we sent it" and "they have it". What this proves is exactly one thing: the registrar stored a row. It does NOT prove anything resolves anywhere, and nothing built on it may say so — the registrar states plainly that record changes in their practice environment succeed through the interface without becoming publicly answerable. A claim about resolution would be caught by the one judge best equipped to catch it.
   record_fact
      Adds one entry to the record. Nothing is stored anywhere else, so what Charter knows is always the record read forward — which is why a run survives a crash or a closed browser tab with nothing lost.

4. Write the contract
   Ask the owners the handful of things the contract cannot be written without, then write it. Every number, every section number and every reference between sections is worked out by fixed rules, so none of it is invented.
   ask_question
      Puts a question on the screen for the owners to answer. Changes nothing, costs nothing, and reaches no outside service. The stage cannot finish while any question is still unanswered, so the agent cannot decide it has heard enough while somebody is still typing.
   record_fact
      Adds one entry to the record. Nothing is stored anywhere else, so what Charter knows is always the record read forward — which is why a run survives a crash or a closed browser tab with nothing lost.
   record_agreement_choice
      These two terms have no safe default. Who runs the company decides whether every owner can bind it or none of them can. Whether there is a way out decides whether an owner can ever leave at all, because Texas states that a member may not withdraw or be expelled, and an agreement that adds nothing leaves that as the deal. So Charter never chooses either one. This tool only writes down what a person already said, and it refuses unless the record shows the question was actually asked and answered.
   draft_agreement
      Builds every number, every article number and every cross-reference in plain code, then hands a finished set of values to the document template. The model chooses WHEN this happens and contributes nothing to WHAT the document says: the words come from a template a person wrote and can read, and the numbers come from arithmetic anybody can check. It refuses rather than filling a gap, because a term a program chose is a term nobody agreed to.

5. Check the owners are who they say
   Read each owner's ID, compare every value on it, and pass anything that is not a clean match to a person to decide. Nothing guesses here.
   read_identity_document
      The document is read by a document service. It is never shown to a model, at any stage, and no model takes any part in deciding which values need a person. That decision is a fixed comparison in code: first whether each value can actually be found in the document, then whether the required fields are there, then format and consistency, and only last the service’s own confidence score — which the service itself says is uncalibrated and not a probability. The rule may always send MORE to a person. It can never send fewer, and this tool cannot clear anything.
   record_fact
      Adds one entry to the record. Nothing is stored anywhere else, so what Charter knows is always the record read forward — which is why a run survives a crash or a closed browser tab with nothing lost.

6. Put it all in one file
   Join everything into a single document, stamp it, and take the fingerprint of exactly what was stamped. From then on, anything that would change the words is turned down, and the refusal is written down.
   assemble_pack
      The order is the point. Merge, then seal, then fingerprint the sealed bytes, and nothing that rewrites the file may run afterwards. A document service with no signing operation can still take a signed contract and make its signature unverifiable — flattening destroys the signature field, a watermark rewrites the page, deleting pages can remove the signed page outright. Stopping an agent making a promise is not the same as stopping it unmaking one. After the seal every rewriting operation is refused and the refusal is recorded, so the finished pack can print what Charter was asked to do and would not.

7. Hand it to a person
   Charter stops here. A person says yes, and separate code that Charter cannot reach carries the file to them to sign.
   No tools. The model is asked for nothing in this stage.
   This is the stage where a person signs. Its emptiness is the design.

8. Put the website online
   Build the business a website, draw its first picture from the owners' own words, put it online, and point the web address at it.
   draw_storefront
      A business formed this morning owns no photographs. It has no shopfront photographed, no products, no staff pictures. The one thing it does have is the sentence its owners typed in stage one, which is already in the record because it started the legal work. That sentence does a second job here. The words sent are the OWNERS’ OWN, read from the record, not something a model wrote about them, and the record keeps both the words and the picture so a person can see what produced what. No photograph of any person is ever sent, and the same company’s face and skin tools are absent from every stage of this project. A business formation tool has no business touching anybody’s face.
   publish_site
      The last thing a newly formed business needs is somewhere to be found. The address was registered in stage three under a permission a person gave, and this points a site at it. It will not publish to an address that was never registered, because a site at an address we do not hold is a site that belongs to somebody else.

Not on this list, and not reachable from anything on it:
   Asking a person to sign. Charter never signs on a human's behalf, and
   there is no tool for it in any stage. A test follows every import out of
   the tool folder and fails the build if the signing module can be reached
   from it through any chain of any length.
```
