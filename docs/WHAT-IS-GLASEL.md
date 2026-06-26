# What is Glasel

Glasel is a network that lets computers work on private information without ever seeing it.

Here is a real situation. Two hospitals each treat patients with the same rare disease. Hospital A has 80 such patients, Hospital B has 95. Apart, 80 or 95 cases is too few to be sure of anything. Together, 175 patients would be enough to see, for example, that one drug cuts relapses by 30 percent. But the law forbids them from sharing patient files, and neither will hand its records to the other. So the answer that could save lives stays locked away.

Glasel is built for exactly this. Both hospitals feed their private records into the network, get the combined answer they need, and never reveal a single patient record to anyone. Not to each other, and not even to the machines doing the work.

The simple picture is a sealed envelope that can be added up without being opened. Your secret goes in, the useful work happens, the answer comes out, and the contents are never seen by anyone.

This matters because of how things work today. When an app needs your data, it has to unlock it first. Your medical records, your salary, your trades, your messages. They sit exposed on some company's server while the work happens. Glasel removes that exposed moment. The data stays sealed from start to finish, and you still get the result you wanted.

It runs on top of Base, a popular public blockchain, so the rules are enforced by code anyone can check, not by a company you have to trust.

---

## The Problem It Solves

Right now there is a painful trade off in software. You can keep data private, or you can do something useful with it. You rarely get both.

A few examples of the squeeze:

A hospital wants to study patient data with another hospital to find better treatments. They legally cannot hand over the raw files.

Two banks suspect the same customer of fraud. They could catch it together, but sharing customer lists would break privacy law and leak business secrets.

You want a loan based on your real income. The lender wants proof. Today that means handing over your full financial history to a stranger.

An AI company has a powerful model. A business has sensitive data it wants analyzed. Neither wants to reveal their asset to the other.

In every case the answer would help everyone. The blocker is that getting the answer means exposing the secret. So the useful thing simply does not happen. Value is left on the table because privacy and usefulness fight each other.

The current internet also has a deeper habit. Apps collect your data, store it, and become a giant target. Every breach, every leak, every misuse traces back to the same root cause. The data was sitting there readable.

---

## The Solution

Glasel breaks the trade off. It lets many parties get a shared answer from their combined data while each keeps their own input completely hidden.

Here is the simple version. Your secret is split into scrambled pieces and spread across many independent machines. No single machine holds enough to know anything. The machines then run the agreed calculation on these scrambled pieces and produce a scrambled result. Only the rightful owner can unlock the final answer.

So the inputs go in private, the work happens private, and only the intended result comes out. The raw data is never assembled in one place, never decrypted, and never visible to the operators.

Because it lives on a public blockchain, three more things are true:

The rules are public and cannot be quietly changed.

The machines doing the work are paid to be honest and punished if they cheat.

Anyone can verify that the result is genuine, without seeing the private inputs.

In short, Glasel turns "trust us with your data" into "you never have to hand it over in the first place."

---

## Technical Architecture

Glasel has four main parts that work together. Here they are in plain terms.

**The smart contracts.** These live on the Base blockchain and act as the rulebook and the referee. They take in requests, hold the payments, pick the machines for each job, check that results are valid, and pay or punish the operators. Nobody can override them.

**The node network.** These are the independent machines that do the actual private computing. They are run by different people in different places. Each one holds only scrambled fragments, so no operator can spy on the data. They are called nodes, and the software they run is called glaseld.

**The privacy engine.** This is the math that makes the magic possible. It splits secrets into pieces, computes on those pieces, and proves the answer is correct. It is built to stay safe even if some of the machines actively try to cheat, which is the strongest level of protection in this field.

**The developer tools.** A software kit and a command line tool that let any developer build apps on Glasel without needing to understand the deep math underneath. They describe what calculation they want, and the tools handle the rest.

A single token, called GLASEL, ties the system together. Operators lock up tokens as a security deposit. If they do honest work they earn fees. If they cheat or go offline, part of their deposit is taken away. This makes good behavior the profitable choice.

---

## How It Works

Let us follow a real example with real numbers. Three people are bidding on the same house. Maria bids 512,000 dollars, David bids 498,000, and Aisha bids 505,000. The seller wants the highest bid to win, but nobody should see the losing bids, because that reveals how much each person was secretly willing to pay. The seller should learn only the winner and the winning price.

Every step below is an actual action recorded on the Base blockchain. The main contract running the show is the ComputationCoordinator, live at an address that looks like 0x1FbB...8452 (shortened here for readability).

**Step 1. Seal.** Each buyer's app uses the Glasel developer kit to encrypt their bid with the network's public key. Maria's 512,000 turns into an unreadable blob, something like 0x7af9c2...e10. David's and Aisha's bids do the same.

**Step 2. Request.** Maria's app calls the `commission` function on the ComputationCoordinator contract. It attaches her sealed bid, points to the published auction program (the "highest bid wins" rule), and pays the job fee in GLASEL tokens. The fee, about 5 GLASEL here, is quoted automatically by the FeeOracle contract. David and Aisha each do the same.

**Step 3. Assign.** The ComputationCoordinator picks an active group of operator machines from the ClusterManager contract, in this case 3 independent nodes, and sets a 150 second deadline. Each of those nodes has already locked 10,000 GLASEL in the StakingManager contract as a security deposit, so they have real money at risk.

**Step 4. Compute.** The 3 nodes split each sealed bid into fragments and run the auction program together. They compare 512,000, 498,000, and 505,000 without any node ever seeing those numbers. The math finds that the first bid is largest while every value stays hidden.

**Step 5. Sign.** The 3 nodes jointly produce a single signature over the sealed result. This threshold signature proves that a required majority of the group agreed. One rogue node cannot forge it alone.

**Step 6. Verify and deliver.** A node calls the `submitResult` function on the ComputationCoordinator, sending the sealed result plus that joint signature. The contract verifies the signature using a built in cryptographic check on Base, then records the result and holds the 5 GLASEL fee in escrow. If the nodes had missed the 150 second deadline, anyone could call `slashTimedOut` and the nodes would lose 5 percent of their deposit, which is 500 GLASEL each. If someone proves the answer is wrong during the one hour challenge window by calling `challengeResult`, the cheating nodes lose 30 percent, which is 3,000 GLASEL each. Once the window passes cleanly, `finalizeComputation` releases the fee, paying the operators 90 percent and the network treasury 10 percent.

**Step 7. Unlock.** The seller's app decrypts the sealed result with their private key and reads "Maria wins at 512,000." David's 498,000 and Aisha's 505,000 were never seen by the seller, the other buyers, or the machines, and never will be.

Every function named above is a real call you can look up on Base. Swap the house auction for the hospital study, a bank fraud check, or a private vote, and the same contracts and the same seven steps apply.

---

## How Big Is This Market

The need here is enormous because almost every industry runs on sensitive data it is afraid to share.

The market for privacy preserving and confidential computing is already measured in billions of dollars per year and is one of the faster growing areas in technology. Analysts widely expect it to multiply several times over within this decade as privacy laws tighten and data breaches keep getting more expensive.

Three forces are pushing this growth at the same time.

Regulation is getting stricter everywhere. Laws now punish companies heavily for leaking personal data, so businesses are hunting for ways to use data without holding it in the open.

Breaches are getting more costly. The average serious data breach now costs a company millions, plus the damage to reputation. Removing the exposed data entirely is the cleanest fix.

AI is hungry for data. The most valuable AI use cases need access to private records, financial data, and personal information. Privacy technology is the bridge that lets AI use this data safely.

Add to this the entire blockchain world, which today is almost completely public by default. Bringing privacy to public blockchains opens a whole new category of applications that simply cannot exist yet.

The short version. Any business that holds data it cannot share is a potential customer. That is most businesses on earth.

---

## Where It Can Be Used

Glasel is a general tool, so it fits many industries. Here are the clearest fits.

**Healthcare.** Hospitals and researchers can study patient data together to spot disease patterns and improve treatments, without any of them exposing individual records. Drug companies can run joint studies while keeping their research private.

**Defence and government.** Agencies and allied nations can compare intelligence, check watchlists, and coordinate without revealing their sources or full databases to each other. Sensitive operations stay secret while still benefiting from shared insight.

**AI and machine learning.** Companies can train and run AI models on private data that was previously off limits. A model can give you an answer based on your personal information without the model owner ever seeing that information, and without you seeing the model. Both sides keep their crown jewels.

**Banking and finance.** Banks can jointly detect fraud and money laundering across institutions without sharing customer lists. People can prove they qualify for a loan or a service without handing over their full financial life.

**Crypto and blockchain.** Today most blockchain activity is fully public, which scares away serious users. Glasel enables private trading, sealed bid auctions, confidential voting, and dark pools where order sizes stay hidden until settlement. It brings the privacy of traditional finance to open networks.

**Everyday business.** Companies in the same industry can benchmark salaries, prices, or supply chains against each other without revealing their own numbers. Advertisers can measure results without vacuuming up personal data.

The common thread. Anywhere two or more parties would benefit from a shared answer but cannot share the raw data, Glasel fits.

---

## Product Details

Glasel ships as a set of practical pieces so different people can use it in the way that suits them.

**The developer kit (SDK).** A ready made software library for building apps on Glasel. It handles the hard parts of sealing data, sending requests, and unlocking results. A developer can add private computing to their app with a handful of simple commands, using familiar tools they already know.

**The node software (glaseld).** The program that operators run to join the network, do private computations, and earn fees. It comes with clear setup guides, ready made containers, and monitoring built in, so running a node is straightforward.

**The builder tool (glaselvm).** A command line tool that lets developers describe the private calculation they want, then package and publish it to the network. It can even generate starter project files automatically, so a new developer can go from nothing to a working private app quickly.

**The developer guide and templates.** Step by step documentation plus ready made examples for common needs like sealed auctions, private voting, and confidential order matching. Developers can copy a template and adapt it rather than starting from scratch.

**The token (GLASEL).** Used to pay for computations, to secure the network through operator deposits, and to vote on how the network evolves.

Everything is already live and tested on Base Sepolia, the public test version of the Base network, with a full suite of automated checks confirming it works end to end.

---

## How Developers Build Private Apps

The whole point is that a developer does not need to be a cryptography expert. The flow is designed to feel familiar.

First, the developer describes the private calculation they want. For example, "compare two sealed bids and return the higher one." They can write this in plain code using simple, readable operations, or pick a ready made template.

Second, they publish that calculation to the network with one command. It gets a permanent address that anyone can call.

Third, they connect it to their app using the developer kit. Their users seal their inputs, the app sends them to Glasel, and the result comes back ready to unlock.

Fourth, the developer adds a small piece of logic to decide what happens when the result arrives, like settling an auction or recording a vote.

That is it. The developer never touches the deep math. They get private computing the same way they would add a payment button or a login system, as a service they plug in.

This opens the door to a new class of applications. Private marketplaces where bids stay hidden. Voting where individual choices are secret but the tally is provable. Lending that checks your income without seeing your bank statements. Games and auctions where no one can peek at the other players. Tools that let rival companies cooperate without trusting each other.

---

## Vision and Mission

**The mission.** Make privacy the default for the digital world, without giving up the usefulness that makes technology worth having.

**The vision.** A future where you never have to hand over your raw data to get value from it. Where hospitals, banks, governments, and AI systems can all work together on the things that matter, while every individual keeps full control of their own information. Where "share your data to use this service" is replaced by "your data stays yours, always."

Today the internet forces a choice between being useful and being private. Glasel is built to end that choice. It gives the world a way to compute on secrets without ever revealing them, and it does so on open, public infrastructure that anyone can verify and no single company can control.

The goal is simple to say and large to achieve. A digital economy that runs on trust by design, not trust by hope.
