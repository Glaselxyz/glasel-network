import Link from "next/link";
import {
  ArrowRight,
  Lock,
  EyeOff,
  ShieldCheck,
  Boxes,
  Coins,
  CheckCircle2,
  TrendingDown,
  Gavel,
  Vote,
  Bot,
  Fingerprint,
  HeartPulse,
  ChevronDown,
} from "lucide-react";
import { CodeWindow } from "@/components/code-window";
import { Stage } from "@/components/three/stage";
import { Reveal, CountUp, SpotlightCard, Stagger, staggerItem, Magnetic } from "@/components/motion";
import { MotionItem } from "@/components/motion-item";
import { site, contracts } from "@/lib/site";
import { short } from "@/lib/utils";

const heroSample = `import { GlaselClient, ORDER_SCHEMA } from "@confide/client";
import { createPublicClient, http, defineChain } from "viem";

const robinhood = defineChain({ id: 46630, name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } });

const glasel = new GlaselClient({
  publicClient: createPublicClient({ chain: robinhood, transport: http() }),
  addresses: { coordinator, clusterManager, mxeFactory },
});

// 1 — Encrypt a typed value to the cluster's X25519 key.
const clusterKey = await glasel.getClusterPublicKeyForMXE(mxeId);
const { encInputs } = glasel.encrypt({
  schema: ORDER_SCHEMA, clusterKey,
  value: { price: 1000n, quantity: 7n, side: true, buyerKey },
});

// 2 — Commission on-chain. Inputs are never decrypted on Robinhood Chain.
const computationId = await commission(mxeId, compDefId, encInputs);

// 3 — The network computes, threshold-signs, and settles.
const { encResult } = await glasel.watchComputation({ computationId });
const result = glasel.decryptResult({ encResult, privateKey, schema: ORDER_SCHEMA });`;

const circuitSample = `// order_notional.rs  —  compiled with \`confidevm compile\`
// The whole body runs inside MPC. No party, and no
// on-chain observer, ever sees \`price\` or \`quantity\`.
#[confidential]
fn order_notional(price: u64, quantity: u64) -> u64 {
    price * quantity
}`;

const acts = [
  {
    n: "01",
    eyebrow: "Encrypt",
    title: "Sealed on the client.",
    body: "Your user's data is encrypted before it ever leaves their device. What travels the network is ciphertext. Even Glasel cannot read it.",
    align: "left" as const,
  },
  {
    n: "02",
    eyebrow: "Compute",
    title: "Computed without being seen.",
    body: "A network of independent nodes runs your program on the encrypted data using multi-party computation. No single node holds enough information to see the plaintext. None of them ever do.",
    align: "left" as const,
  },
  {
    n: "03",
    eyebrow: "Verify",
    title: `Verified and settled on ${site.networkLabel}.`,
    body: "The result arrives threshold-signed by the node cluster and verified on-chain before your contract acts on it. You don't have to trust the nodes — the math checks their work for you.",
    align: "right" as const,
  },
];

const problems = [
  { icon: TrendingDown, tag: "Finance", body: "A hedge fund can't put its order flow on-chain. Front-running bots see every trade before it executes." },
  { icon: HeartPulse, tag: "Healthcare", body: "A hospital can't store patient records on a blockchain. Every balance would be public." },
  { icon: Bot, tag: "AI", body: "An AI company can't run inference on-chain. Every prompt would be readable by anyone." },
];

const features = [
  { icon: Lock, title: "End-to-end encrypted", body: "Your users' data is encrypted on their device with X25519 and Rescue-Prime — a cipher designed to run inside multi-party computation. Plaintext never exists on the network." },
  { icon: EyeOff, title: "The network computes blind", body: "The arxOS node network runs your compiled circuit across a cluster of independent operators. Each holds a fragment of the computation. None — below the threshold — can see the inputs." },
  { icon: ShieldCheck, title: "Results you don't have to trust", body: "Every result carries a BLS threshold signature from the cluster, verified on-chain before your callback fires. You don't take the network's word for it. The contract checks the math." },
  { icon: Boxes, title: `${site.networkLabel} handles the rules`, body: `Eight smart contracts on ${site.networkLabel} schedule jobs, verify results, distribute fees, and slash misbehaving nodes. Transparent, auditable, and upgradeable — as protocol infrastructure should be.` },
  { icon: Coins, title: "Nodes have skin in the game", body: "Every Arx node stakes $GLASEL to join a cluster. Miss a deadline or submit a wrong result and the stake is slashed automatically — no committee, no appeals. The incentives enforce themselves." },
];

const devBullets = [
  "Simulate locally before you deploy — no nodes needed for testing",
  "One command from source to testnet",
  "Typed inputs — write structs, not field elements",
  "The encryption is identical on client and server — proven byte-for-byte",
];

const useCases = [
  { icon: TrendingDown, title: "Dark pools", body: `Place large trades without bots seeing your order first. The first private order book on ${site.networkLabel}.` },
  { icon: Gavel, title: "Sealed auctions", body: "Bidders can't see each other's bids. The highest bid wins. The losing bids stay sealed." },
  { icon: Vote, title: "Private voting", body: "On-chain governance where votes are secret until the poll closes — no bandwagon effect, no coercion." },
  { icon: Bot, title: "Confidential AI", body: "Run model inference on encrypted inputs. The model never sees your users' prompts. Neither does anyone else." },
  { icon: Fingerprint, title: "Compliance scoring", body: "Score wallets or transactions without exposing the criteria — or the results — to anyone but the requester." },
];

export default async function Home() {
  const coordinator = contracts[0];
  return (
    <>
      <Stage />

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative flex min-h-[100svh] items-center">
        <div className="container-page grid w-full grid-cols-1 gap-10 pb-16 pt-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <Reveal>
              <Link href="/docs/network" className="badge transition-colors hover:text-white">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan" />
                </span>
                Live on {site.chain.name}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Reveal>

            <Stagger
              gap={0.14}
              className="mt-6 font-display text-[2.5rem] font-extrabold leading-[1.03] tracking-tight sm:text-6xl lg:text-[4rem]"
            >
              <MotionItem variants={staggerItem}>
                <span className="block text-white" style={{ textShadow: "0 2px 40px rgba(6,12,20,0.85)" }}>
                  Every on-chain app is public.
                </span>
              </MotionItem>
              <MotionItem variants={staggerItem}>
                <span className="block gradient-text" style={{ textShadow: "0 2px 40px rgba(6,12,20,0.85)" }}>
                  Glasel makes it private.
                </span>
              </MotionItem>
            </Stagger>

            <Reveal delay={220}>
              <p
                className="mt-6 max-w-md text-lg leading-relaxed text-ink/85"
                style={{ textShadow: "0 2px 24px rgba(6,12,20,0.92)" }}
              >
                Confidential computing on {site.networkLabel} — encrypted in, computed blind, verified on-chain.
              </p>
            </Reveal>

            <Reveal delay={320}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Magnetic>
                  <Link href="/docs/quickstart" className="btn-primary">
                    Start building <ArrowRight className="h-4 w-4" />
                  </Link>
                </Magnetic>
                <Link href="/docs" className="btn-ghost">
                  Read the docs
                </Link>
              </div>
            </Reveal>
          </div>

          <div aria-hidden className="hidden lg:block" />
        </div>

        <Reveal delay={600} className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 text-faint">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Scroll</span>
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </Reveal>
      </section>

      {/* ───────────────────────── Steps (3D narrative) ───────────────────────── */}
      {acts.map((a) => (
        <section key={a.n} className="relative flex min-h-[100svh] items-center">
          <div className="container-page w-full">
            <div className={a.align === "right" ? "ml-auto max-w-md text-right" : "max-w-md"}>
              <Reveal>
                <div
                  className="flex items-baseline gap-3"
                  style={{ justifyContent: a.align === "right" ? "flex-end" : "flex-start" }}
                >
                  <span className="font-mono text-sm text-cyan">{a.n}</span>
                  <span className="font-mono text-xs uppercase tracking-[0.25em] text-faint">{a.eyebrow}</span>
                </div>
              </Reveal>
              <Reveal delay={100}>
                <h2
                  className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl"
                  style={{ textShadow: "0 2px 40px rgba(6,12,20,0.9)" }}
                >
                  {a.title}
                </h2>
              </Reveal>
              <Reveal delay={180}>
                <p
                  className="mt-5 text-base leading-relaxed text-ink/85 sm:text-lg"
                  style={{ textShadow: "0 2px 24px rgba(6,12,20,0.95)" }}
                >
                  {a.body}
                </p>
              </Reveal>
            </div>
          </div>
        </section>
      ))}

      {/* ───────────────────────── Content sheet (3D recedes) ───────────────────────── */}
      <div
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(6,12,20,0.85) 8%, var(--bg) 22%, var(--bg) 100%)",
        }}
      >
        {/* The problem */}
        <section className="container-page py-24">
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="eyebrow-line mx-auto inline-block font-mono text-xs uppercase tracking-[0.25em] text-cyan">
              The problem
            </div>
            <p className="serif mx-auto mt-6 max-w-2xl text-2xl leading-snug text-ice sm:text-[1.7rem]">
              “$3 billion is taken from traders every year by front-running bots — because every on-chain
              trade is public before it executes.”
            </p>
            <h2 className="mx-auto mt-8 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
              Blockchains are public by design. That's what makes them trustworthy — and the wall that
              has kept every sensitive application out.
            </h2>
          </Reveal>

          <Stagger className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
            {problems.map((p) => {
              const Icon = p.icon;
              return (
                <MotionItem key={p.tag} variants={staggerItem}>
                  <SpotlightCard className="card h-full p-6" tilt={false}>
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-xl"
                      style={{
                        background: "linear-gradient(140deg, rgba(111,233,255,0.18), rgba(62,143,230,0.24))",
                        border: "1px solid rgba(111,233,255,0.22)",
                      }}
                    >
                      <Icon className="h-5 w-5 text-cyan" />
                    </span>
                    <div className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-faint">{p.tag}</div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
                  </SpotlightCard>
                </MotionItem>
              );
            })}
          </Stagger>

          <Reveal delay={120} className="mx-auto mt-10 max-w-2xl text-center">
            <p className="text-base leading-relaxed text-muted sm:text-lg">
              These aren't edge cases. They're the three largest markets in enterprise software — finance,
              healthcare, and AI — and none of them can use blockchain today, because there is no such thing
              as private computation on a public network.{" "}
              <span className="serif text-xl text-cyan">Until Glasel.</span>
            </p>
          </Reveal>
        </section>

        {/* Code sample */}
        <section className="container-page py-12">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Three function calls. <span className="gradient-text">Fully private.</span> Proven on-chain.
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <SpotlightCard className="grad-border animate-float-soft mx-auto mt-8 max-w-3xl rounded-2xl">
              <CodeWindow code={heroSample} filename="trade.ts" className="glow-iris" />
            </SpotlightCard>
          </Reveal>
          <Reveal delay={160} className="mx-auto mt-6 max-w-xl text-center">
            <p className="text-sm leading-relaxed text-muted">
              The encryption, the MPC execution, and the on-chain verification happen automatically. You
              write the business logic. Glasel handles the confidentiality.
            </p>
          </Reveal>
        </section>

        {/* Proof / stats */}
        <section className="container-page py-16">
          <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={<CountUp value={8} />} label="contracts" body={`Deployed and live on ${site.chain.name} — not a prototype, a full protocol stack.`} />
            <StatCard value={<CountUp value={90} />} label="tests" body="Foundry unit tests plus 20 checks against the live deployment. Every computation path is covered." />
            <StatCard value={<CountUp value={1} />} label="security audit" body="A critical and three high findings — all resolved before this version shipped." />
            <StatCard
              value={<span className="text-2xl">{site.chain.name}</span>}
              label="live today"
              body={
                <>
                  Coordinator at{" "}
                  <a
                    href={`${site.chain.explorer}/address/${coordinator.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-cyan hover:underline"
                  >
                    {short(coordinator.address, 4)}
                  </a>
                  . The code does what it says.
                </>
              }
            />
          </Stagger>
        </section>

        {/* Why Glasel */}
        <section className="container-page py-20">
          <Reveal className="mx-auto max-w-2xl text-center">
            <div className="eyebrow-line mx-auto inline-block font-mono text-xs uppercase tracking-[0.25em] text-cyan">
              Why Glasel
            </div>
            <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              A complete confidential computing stack.
            </h2>
            <p className="mt-3 text-muted">Everything you need. Nothing you have to trust.</p>
          </Reveal>
          <Stagger className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <MotionItem key={f.title} variants={staggerItem} className="h-full">
                  <SpotlightCard className="card h-full p-6" tilt={false}>
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-xl"
                      style={{
                        background: "linear-gradient(140deg, rgba(111,233,255,0.22), rgba(62,143,230,0.28))",
                        border: "1px solid rgba(111,233,255,0.25)",
                      }}
                    >
                      <Icon className="h-5 w-5 text-cyan" />
                    </span>
                    <h3 className="mt-4 text-[15px] font-semibold text-white">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
                  </SpotlightCard>
                </MotionItem>
              );
            })}
          </Stagger>
        </section>

        {/* Developer section */}
        <section className="container-page py-20">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="eyebrow-line inline-block font-mono text-xs uppercase tracking-[0.25em] text-cyan">
                For developers
              </div>
              <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Write circuits, not crypto.
              </h2>
              <p className="mt-3 max-w-md text-muted">
                You define what the computation does. Glasel makes it impossible for anyone to see the data
                it runs on.
              </p>
              <ul className="mt-8 space-y-3.5">
                {devBullets.map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-sm text-muted">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                    {t}
                  </li>
                ))}
              </ul>
              <Magnetic className="mt-8">
                <Link href="/docs/circuits" className="btn-ghost">
                  Circuit guide <ArrowRight className="h-4 w-4" />
                </Link>
              </Magnetic>
            </div>
            <div>
              <Reveal>
                <p className="mb-3 text-sm font-medium text-white">This is the entire confidential function.</p>
              </Reveal>
              <Reveal delay={120}>
                <SpotlightCard className="grad-border rounded-2xl">
                  <CodeWindow code={circuitSample} lang="rust" filename="order_notional.rs" />
                </SpotlightCard>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-3 text-sm text-muted">The MPC network runs it. Nobody reads the inputs.</p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Use cases / CTA */}
        <section className="container-page py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              If it's sensitive, it belongs on <span className="gradient-text">Glasel.</span>
            </h2>
          </Reveal>

          <Stagger className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {useCases.map((u) => {
              const Icon = u.icon;
              return (
                <MotionItem key={u.title} variants={staggerItem} className="h-full">
                  <SpotlightCard className="card h-full p-6">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                        style={{
                          background: "linear-gradient(140deg, rgba(111,233,255,0.2), rgba(62,143,230,0.26))",
                          border: "1px solid rgba(111,233,255,0.22)",
                        }}
                      >
                        <Icon className="h-[18px] w-[18px] text-cyan" />
                      </span>
                      <h3 className="text-[15px] font-semibold text-white">{u.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted">{u.body}</p>
                  </SpotlightCard>
                </MotionItem>
              );
            })}
            <MotionItem variants={staggerItem} className="h-full">
              <div className="card flex h-full flex-col items-start justify-center gap-4 p-6">
                <p className="text-sm text-muted">Build the first one on {site.networkLabel}.</p>
                <Magnetic>
                  <Link href="/docs/quickstart" className="btn-primary">
                    Start building <ArrowRight className="h-4 w-4" />
                  </Link>
                </Magnetic>
                <a href={site.github} target="_blank" rel="noreferrer" className="text-sm text-cyan hover:underline">
                  Star on GitHub →
                </a>
              </div>
            </MotionItem>
          </Stagger>
        </section>
      </div>
    </>
  );
}

function StatCard({
  value,
  label,
  body,
}: {
  value: React.ReactNode;
  label: string;
  body: React.ReactNode;
}) {
  return (
    <MotionItem variants={staggerItem} className="h-full">
      <div className="card h-full p-5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl text-gradient">{value}</span>
          <span className="text-sm text-muted">{label}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">{body}</p>
      </div>
    </MotionItem>
  );
}
