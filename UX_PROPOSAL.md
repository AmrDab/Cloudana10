# Cloudana UX Proposal: Three Core Flows

## Executive Summary

This proposal outlines concrete, intuitive UI/UX for three critical user journeys in Cloudana:

1. **Provider Onboarding** — From "I have a machine" → earning in minutes, zero network/K8s knowledge required
2. **Consumer Deploy** — Template gallery → live endpoint in one click, all complexity hidden
3. **Decentralization Transparency** — A trust-building dashboard showing what's centralized today and the roadmap to full decentralization

Each includes page layouts, interactions, copy tone, and reusable component patterns matched to the existing React 19 + TailwindCSS + Wagmi stack.

---

## 1. Provider Plug-and-Play Onboarding

### Design Philosophy
- **Progressive disclosure**: show only what's needed now, not everything
- **Hardware auto-detection**: provider detects CPU/GPU/RAM automatically on setup, user just confirms
- **One-click installers**: native Windows/macOS/Linux desktop app or shell script
- **Earnings visualization**: real-time earnings display front and center
- **Path splits by user type**: Technical users can customize; non-technical users follow guided happy path

### Flow Overview

```
Landing Page (Get Started) 
  ↓
Installer Download / Run Setup
  ↓
Hardware Detection & Confirmation
  ↓
Wallet Connection (if not already connected)
  ↓
Provider Registration (1-click with auto-detected values)
  ↓
Setup Complete — Earnings Dashboard
```

---

### **Page 1: Provider Onboarding Landing**

**Route**: `/provider/onboard`

**Purpose**: Explain provider pitch and offer clear CTA.

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  CLOUDANA PROVIDER NETWORK                           │
│  Plug Your Hardware → Start Earning                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Hero Section:                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  Icon: Server with dollar sign               │   │
│  │  Headline: "Any hardware. Instant earnings." │   │
│  │  Subhead: "Plug in your GPU, CPU, or ARM."  │   │
│  │           We handle the rest.                │   │
│  │                                              │   │
│  │  3 Simple Steps (left-aligned icons):        │   │
│  │  ✓ Download installer for your OS           │   │
│  │  ✓ We detect your hardware automatically    │   │
│  │  ✓ Approve registration → earn money        │   │
│  │                                              │   │
│  │  CTA Button (large, primary):                │   │
│  │  [↓ Download Provider Agent]                 │   │
│  │   Subtitle: "45 MB • macOS / Linux / Windows"│   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Features Grid (3 columns):                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Lock    │ │ Chart    │ │ Zap      │           │
│  │ Secure  │ │ Earnings │ │ Instant  │           │
│  │ All data│ │ Real-time│ │ Setup    │           │
│  │ stays   │ │ USD or   │ │ No sysad │           │
│  │ local   │ │ CLD      │ │ needed   │           │
│  └──────────┘ └──────────┘ └──────────┘           │
│                                                      │
│  FAQ Accordion:                                     │
│  ❓ What if I don't have a GPU?                     │
│     → CPU-only nodes earn too. Same registry.      │
│  ❓ How much can I earn?                            │
│     → Depends on your hardware tier + network      │
│     demand. Check the pricing calculator.          │
│  ❓ Is my data safe?                                │
│     → You control everything. We never access      │
│     your hardware directly.                        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Components**:
- Hero card with gradient background (match `glass-card` pattern from provider-register.tsx)
- 3-step checklist with icons (lucide: Download, Cpu, Zap)
- Feature grid: `<Card>` with centered icon + headline + description
- FAQ: shadcn `<Accordion>` 
- Primary CTA: `<Button className="bg-gradient-to-r from-primary to-orange-600">`

**Copy Tone**: Friendly, confident, non-technical. Avoid jargon like "node," "registry," "metadata."

---

### **Page 2: Hardware Detection & Setup Confirmation**

**Route**: `/provider/setup` (after installer runs)

**Trigger**: User runs installer script → agent sends device fingerprint + auto-detected specs → console shows setup UI

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  CLOUDANA PROVIDER SETUP                            │
│  We detected your hardware. Ready to register?       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Step Indicator: [1. Setup] [2. Confirm] [3. Done] │
│                    ↑ CURRENT                        │
│                                                      │
│  Hardware Summary (read-only card):                 │
│  ┌──────────────────────────────────────────────┐   │
│  │  ✓ Hardware Detected                         │   │
│  │                                              │   │
│  │  Tier: GPU-T2 (NVIDIA A100)                 │   │
│  │  CPU:  16 cores, 2.3 GHz (Intel Xeon)      │   │
│  │  RAM:  256 GB DDR4                          │   │
│  │  GPU:  4 × A100 (40 GB each)                │   │
│  │  Storage: 4 TB NVMe SSD                      │   │
│  │  Bandwidth: 10 Gbps Fiber                    │   │
│  │  Location: Detected as Helsinki, Finland     │   │
│  │                                              │   │
│  │  [✎ Edit details if incorrect]              │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Provider Identity:                                 │
│  ┌──────────────────────────────────────────────┐   │
│  │  Provider Name: [Auto-generated name]        │   │
│  │                 [← Use auto] [← Custom name] │   │
│  │                                              │   │
│  │  Region: Helsinki [dropdown menu]            │   │
│  │  Capacity: 1 server [slider: 1-10]          │   │
│  │                                              │   │
│  │  Description (optional):                     │   │
│  │  [General-purpose compute node...]          │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Earnings Estimate (info card):                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Based on GPU-T2 tier + current network      │   │
│  │  demand:                                     │   │
│  │                                              │   │
│  │  Estimated Monthly: $2,400 - $4,100 CLD    │   │
│  │  (varies by job frequency)                   │   │
│  │                                              │   │
│  │  [💡 See pricing calculator for details]    │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Actions:                                           │
│  [← Back] [Next: Review & Register →]               │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Components**:
- `<Card>` with green checkmark badge for "Hardware Detected"
- Read-only spec display using `<LabelValue>` component pattern (from providers/LabelValue.tsx)
- Inline edit button for "correct details if needed" → pops small modal or expands collapsed `<Collapsible>`
- `<Slider>` for capacity (reuse from provider-register.tsx)
- Estimate card with `⚡` icon for earnings (reuse color scheme from status.tsx green success state)
- Step indicator: `<Breadcrumb>` or custom progress bar

**Key Interactions**:
- "Edit details" expands form to adjust CPU/GPU/RAM/storage manually (advanced user path)
- "Use auto" button auto-fills provider name from hardware (e.g., "A100 Node #1")
- Earnings estimate updates when hardware tier or capacity changes
- "Next" button disabled until wallet is connected (check `useAccount()`)

---

### **Page 3: Registration & Setup Complete**

**Route**: `/provider/complete` (after registration succeeds)

**Trigger**: Blockchain tx confirms registration

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  CLOUDANA PROVIDER SETUP                            │
│  Registration Complete — You're Earning!             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Step Indicator: [1. Setup] [2. Confirm] [3. Done] │
│                                        ✓ CURRENT   │
│                                                      │
│  Success Card (green background):                   │
│  ┌──────────────────────────────────────────────┐   │
│  │  ✓ PROVIDER REGISTERED                       │   │
│  │                                              │   │
│  │  Your node is now live on the Cloudana      │   │
│  │  network and accepting jobs.                 │   │
│  │                                              │   │
│  │  TX: 0x... [↗ View on Basescan]             │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Quick Stats (3-column grid):                       │
│  ┌──────────┬──────────┬──────────┐               │
│  │ Hardware │ Tier     │ Capacity │               │
│  │ GPU-T2   │ 5x reward│ 1 server │               │
│  └──────────┴──────────┴──────────┘               │
│  ┌──────────┬──────────┬──────────┐               │
│  │ Status   │ Earnings │ Live     │               │
│  │ Active   │ $0.00    │ Now      │               │
│  └──────────┴──────────┴──────────┘               │
│                                                      │
│  Next Steps Card:                                   │
│  ┌──────────────────────────────────────────────┐   │
│  │  What's Next?                                │   │
│  │                                              │   │
│  │  1. Monitor your earnings in real-time      │   │
│  │     [→ Go to Provider Dashboard]             │   │
│  │                                              │   │
│  │  2. Help build Cloudana. Send feedback      │   │
│  │     [→ Discord Community] [→ Suggest Ideas] │   │
│  │                                              │   │
│  │  3. Register another provider (different     │   │
│  │     hardware or location)                    │   │
│  │     [→ Add Another Node]                     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Actions:                                           │
│  [← Back] [Go to Dashboard →]                       │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Components**:
- `<Card className="border-green-500/20 bg-green-500/5">` with `<CheckCircle>` (reuse from status.tsx)
- TxLink component to view blockchain confirmation
- 3-column stat grid (similar to mining-dashboard.tsx patterns)
- Next steps as an ordered list inside a card
- CTAs: "Go to Dashboard" (primary) + "Add Another Node" (secondary)

---

### **Provider Dashboard (Ongoing)**

**Route**: `/provider/dashboard`

**Purpose**: Show earnings, node status, active jobs, and health metrics.

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  MY PROVIDER                               [⚙ Settings]
│  GPU-T2 Node #1 (Active)                            │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Quick Stats (4 metrics, card layout):              │
│  ┌──────────┬──────────┬──────────┬──────────┐     │
│  │ Total    │ This     │ Active   │ Monthly  │     │
│  │ Earned   │ Month    │ Jobs     │ Est.     │     │
│  │ $1,234   │ $456     │ 3 running│ $3,200   │     │
│  └──────────┴──────────┴──────────┴──────────┘     │
│                                                      │
│  Earnings Chart (line graph, last 30 days):        │
│  ┌──────────────────────────────────────────────┐   │
│  │ ╱╲    ╱╲      ╱╲                              │   │
│  │╱  ╲  ╱  ╲────╱  ╲ ╱────                       │   │
│  │                                              │   │
│  │ Hover for daily details                     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Node Health (status card):                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  ✓ All Systems Healthy                       │   │
│  │                                              │   │
│  │  Uptime: 99.8% (last 30 days)               │   │
│  │  CPU Usage: 45%  [████░░░░░░]               │   │
│  │  RAM Usage: 72%  [███████░░░]               │   │
│  │  Disk Usage: 61% [██████░░░░]               │   │
│  │  Network: 850 Mbps ↓ / 95 Mbps ↑            │   │
│  │  Last Job: 2 hours ago ✓ completed          │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Active Jobs (table or card list):                 │
│  ┌──────────────────────────────────────────────┐   │
│  │  JOB ID          STATUS    TIME RUNNING  $    │   │
│  │  ─────────────────────────────────────────   │   │
│  │  0x123abc...     Running   1h 23m       $12  │   │
│  │  0x456def...     Running   45m          $8   │   │
│  │  0x789ghi...     Running   12m          $2   │   │
│  │                                              │   │
│  │  [View All Jobs] [View Job History]         │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Recent Logs (expandable):                         │
│  [▼] Last 24 Hours                                 │
│  ├─ 14:32 Job 0x123abc started                    │
│  ├─ 14:22 New workload available                  │
│  ├─ 13:15 Completed job 0x456def                  │
│  └─ 12:08 Network rebalance detected              │
│                                                      │
│  Actions:                                           │
│  [⚙ Configure] [← Back]                            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Components**:
- Top metric cards (reuse `<Card>` with large number typography)
- Chart: Recharts line chart (used elsewhere in app; show `$` on Y-axis)
- Health card with progress bars for CPU/RAM/disk
- Table or `<Card>` list for active jobs (sortable, filterable)
- Collapsible logs section with icons for status (green ✓, yellow ⚠, red ✗)

**Key Interactions**:
- Click job to see details (logs, resource usage, payout calculation)
- Chart hover shows daily total + job count
- Settings button → configure capacity, region, or withdraw earnings
- Real-time updates (socket or polling) for active job count and earnings ticker

---

## 2. Consumer One-Click Deploy

### Design Philosophy
- **Template-first discovery**: show gallery immediately, not forms
- **Search & filter**: find by name/category/hardware requirement
- **Zero SDL/K8s/networking UI**: only ask for name, env vars, and provider choice
- **Deploy confirmation**: show estimated cost before confirming
- **Live endpoint immediately**: URL appears after confirmation, with logs below
- **Logs + monitoring**: tail deployment logs, see resource usage, CPU/memory graphs

### Flow Overview

```
Templates Gallery (search/filter)
  ↓ (click template)
Deploy Config (name + env vars + provider choice)
  ↓ (confirm)
Deploy Starting (progress indicator)
  ↓ (success)
Live Endpoint + Logs + Status
```

---

### **Page 1: Templates Gallery (Enhanced)**

**Route**: `/templates` or `/deployments#templates`

**Current state**: Exists in codebase; this proposal refines UX.

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  TEMPLATE GALLERY                                   │
│  504 templates ready to deploy                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Search + Filters (sticky top):                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ [🔍 Search by name, framework, language...] │   │
│  │                                              │   │
│  │ Category: [All ▼]  Hardware: [All ▼]        │   │
│  │ Tier: [CPU / GPU ▼]                         │   │
│  │                                              │   │
│  │ Results: 152 templates                       │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Category Sidebar (left, sticky):                   │
│  ┌──────────────────┐                               │
│  │ All (504)        │                               │
│  │ Webapps (89)     │                               │
│  │ ML/AI (73)       │                               │
│  │ Databases (45)   │                               │
│  │ DevTools (67)    │                               │
│  │ Gaming (21)      │                               │
│  │ DeFi (19)        │                               │
│  └──────────────────┘                               │
│                                                      │
│  Template Cards (grid, 3 columns):                  │
│  ┌──────────────┬──────────────┬──────────────┐     │
│  │ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │     │
│  │ │ NextJS   │ │ │ FastAPI  │ │ │ TensorFl │ │     │
│  │ │ Logo     │ │ │ Logo     │ │ │ Logo     │ │     │
│  │ │          │ │ │          │ │ │          │ │     │
│  │ │ Full-    │ │ │ Modern   │ │ │ ML model │ │     │
│  │ │ stack    │ │ │ Python   │ │ │ training │ │     │
│  │ │ React    │ │ │ REST API │ │ │ on GPUs  │ │     │
│  │ │ app      │ │ │          │ │ │          │ │     │
│  │ │          │ │ │          │ │ │          │ │     │
│  │ │ [Deploy] │ │ │ [Deploy] │ │ │ [Deploy] │ │     │
│  │ └──────────┘ │ └──────────┘ │ └──────────┘ │     │
│  └──────────────┴──────────────┴──────────────┘     │
│  ┌──────────────┬──────────────┬──────────────┐     │
│  │ [more cards] │ [...]        │ [...]        │     │
│  └──────────────┴──────────────┴──────────────┘     │
│                                                      │
│  Load More / Pagination                             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Differences from current**:
- Add sticky category filter sidebar (mobile: collapse into dropdown)
- Hardware tier filter (CPU-only vs GPU-required)
- Search bar with autocomplete suggestions
- Template card shows: logo, name, 1-line summary, tech tags, [Deploy] button
- Hover effect on card (slight shadow, slight scale) → shows full description tooltip

**Components**:
- Search input with `<Command>` autocomplete (shadcn) 
- Filter dropdowns: `<Select>` from shadcn
- Card grid: reuse existing template card component
- [Deploy] button on each card: primary, no secondary text

---

### **Page 2: Deploy Configuration**

**Route**: `/deployments/deploy?template=<id>` or inline modal

**Trigger**: User clicks [Deploy] on template card

**Layout**:

```
┌──────────────────────────────────────────────────────┐
│  DEPLOY TEMPLATE                                     │
│  NextJS Full-Stack                                   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [⟲ Select Different Template]                      │
│                                                      │
│  Section 1: Deployment Name                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  Name: [my-awesome-app]                      │   │
│  │         (used in URL: my-awesome-app.cloud)  │   │
│  │                                              │   │
│  │  Auto-generate name: [🎲 Generate]           │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Section 2: Environment Variables (optional)        │
│  ┌──────────────────────────────────────────────┐   │
│  │  Add variables from your .env file:          │   │
│  │                                              │   │
│  │  [DATABASE_URL ........ [••••••••••••••] ]   │   │
│  │  [API_KEY ............ [••••••••••••••] ]   │   │
│  │  [STRIPE_SECRET ....... [••••••••••••••] ]   │   │
│  │                                              │   │
│  │  [+ Add Variable]                            │   │
│  │  [💡 Help: which env vars does this need?]  │   │
│  │     (link to template README)                │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Section 3: Provider & Hardware                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Choose a provider:                          │   │
│  │                                              │   │
│  │  ○ Recommend: [GPU-T2 Providers (12 avail)] │   │
│  │    Est. cost: $0.50/hour                     │   │
│  │                                              │   │
│  │  ○ Any: [All Providers (487 available)]      │   │
│  │    Est. cost: $0.20-$0.80/hour (varies)     │   │
│  │                                              │   │
│  │  ○ Custom: [Specific provider ID...]         │   │
│  │                                              │   │
│  │  [? How are providers chosen?]               │   │
│  │  (link to network transparency page)         │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Cost Estimate (info card):                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  Estimated Monthly Cost                      │   │
│  │                                              │   │
│  │  Compute: $10 - $15 (based on provider)     │   │
│  │  Storage: $2/month (5 GB persistent)         │   │
│  │  Network: Included                           │   │
│  │                                              │   │
│  │  Total: ~$12 - $17/month (highly variable)  │   │
│  │                                              │   │
│  │  [💡 Estimated based on template docs]       │   │
│  │      Actual cost billed on usage.             │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Actions:                                           │
│  [← Back to Gallery] [Deploy & Launch →]            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Components**:
- Horizontal layout: left = form, right = template preview (sticky) showing README preview
- Name input: `<Input>` with placeholder "my-app"
- Env vars: custom component (Add/Delete buttons) or reuse if one exists
- Provider selector: `<RadioGroup>` with descriptions
- Cost estimate: `<Card className="border-orange-500/20 bg-orange-500/5">` matching pricing pages
- Actions: back button + primary "Deploy & Launch"

**Key Interactions**:
- Changing provider selection updates cost estimate in real-time
- "Add Variable" adds a new key-value pair row
- Clicking "Help" on env vars opens modal showing template README or example .env file
- Deployment name auto-generates on load (use adjective + noun: "sleek-panda") or let user click 🎲 to regenerate

---

### **Page 3: Deploy in Progress**

**Route**: `/deployments/<id>/deploying` (after confirmation)

**Trigger**: User clicks [Deploy & Launch]

**Layout**:

```
┌──────────────────────────────────────────────────────┐
│  DEPLOYING                                           │
│  my-awesome-app                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Progress (multi-step, animated):                   │
│  ┌──────────────────────────────────────────────┐   │
│  │ ✓ Manifest prepared                          │   │
│  │ ✓ Provider selected (GPU-T2 #5)              │   │
│  │ ⟳ Building image... (3/5)                    │   │
│  │ ○ Waiting for compute                        │   │
│  │ ○ Starting app                               │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Build Log (tail, scrollable, monospace):          │
│  ┌──────────────────────────────────────────────┐   │
│  │ $ docker build -t my-awesome-app:v1 .        │   │
│  │ Sending build context to Docker daemon       │   │
│  │ Step 1/20 : FROM node:20-alpine              │   │
│  │  ---> a1b2c3d4e5f6                           │   │
│  │ Step 2/20 : WORKDIR /app                     │   │
│  │  ---> Running in abc123def456                │   │
│  │ Step 3/20 : COPY package*.json ./             │   │
│  │  ---> a1b2c3d4e5f6                           │   │
│  │ [...]                                        │   │
│  │ Successfully built my-awesome-app:v1         │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Estimated Time: 2-3 minutes                        │
│  Provider: GPU-T2 Node (Helsinki)                   │
│                                                      │
│  Actions:                                           │
│  [← Cancel Deployment]                              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Components**:
- Step progress: vertical list with icons (✓ done, ⟳ in-progress, ○ pending)
- Build log: `<ScrollArea>` with monospace font, dark background (matching dev tools aesthetic)
- Icons: CheckCircle (done), Loader2 (in progress), Circle (pending) from lucide
- Cancel button: secondary, red text

**Key Interactions**:
- Log auto-scrolls as new lines arrive (WebSocket or polling)
- Step expands on click to show more details (optional)
- Cancel button prevents further steps (user can retry)

---

### **Page 4: Deployment Live**

**Route**: `/deployments/<id>`

**Trigger**: Deployment succeeds

**Layout**:

```
┌──────────────────────────────────────────────────────┐
│  MY DEPLOYMENT                                       │
│  my-awesome-app (Active)                             │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Header Section:                                     │
│  Live Endpoint: https://my-awesome-app.cloudana.io/ │
│  [📋 Copy] [↗ Visit] [🔒 Auth]                      │
│                                                      │
│  Status Badge: 🟢 HEALTHY (uptime 99.8%)            │
│  Deployed: 2 hours ago | Provider: GPU-T2 #5        │
│                                                      │
│  Quick Stats (4-column grid):                        │
│  ┌──────────┬──────────┬──────────┬──────────┐     │
│  │ CPU      │ Memory   │ Disk     │ Network  │     │
│  │ 45%      │ 234/512MB│ 1.2/5GB  │ 85Mbps ↓ │     │
│  └──────────┴──────────┴──────────┴──────────┘     │
│                                                      │
│  Resource Usage (last 24h):                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ CPU & Memory                                │   │
│  │ ────────────────────────────────────────── │   │
│  │ 100% ┤      ╱╲    ╱╲                       │   │
│  │  80% ┤     ╱  ╲  ╱  ╲ ╱╲                   │   │
│  │  60% ┼────╱    ╲╱    ╱  ╲                  │   │
│  │  40% ┤                    ╲ ╱╲              │   │
│  │  20% ┤                     ╱  ╲             │   │
│  │   0% └─────────────────────────────         │   │
│  │      0h     6h      12h     18h    24h       │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
│  Recent Logs (collapsible):                         │
│  [▼] Last 50 Lines                                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ 14:32 GET /api/users → 200 (42ms)            │   │
│  │ 14:31 POST /api/submit → 201 (156ms)         │   │
│  │ 14:30 GET / → 200 (8ms)                      │   │
│  │ 14:29 Database connection pool: 3/10 active  │   │
│  │ [...]                                        │   │
│  │ [⬇ Download Full Logs]                      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Actions (top right):                               │
│  [⚙ Settings] [🔄 Redeploy] [🗑 Delete]            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Components**:
- Header card with URL + action buttons (copy, open, auth)
- Status badge: green circle + text (reuse from status.tsx)
- 4-column stat grid with live values
- Recharts line chart for CPU/memory over time
- Collapsible logs section with tail auto-scroll
- Top-right action menu: Settings (scale, env vars), Redeploy, Delete

**Key Interactions**:
- Click [Visit] opens live endpoint in new tab
- Click [Copy] copies URL to clipboard, shows toast
- Settings modal allows scaling (instance count), updating env vars, or changing provider (re-deploy)
- Logs auto-tail from WebSocket
- Charts update every 5 seconds

---

## 3. Decentralization Status Dashboard

### Design Philosophy
- **Transparency as feature**: clearly show what's centralized today vs decentralized roadmap
- **Visual honesty**: use clear color coding (red=centralized, amber=semi, green=decentralized)
- **Roadmap credibility**: concrete timeline, not vague promises
- **Build trust**: let users see the path to true DePIN
- **No jargon**: explain each component in plain English

### Flow Overview

```
Open dashboard at `/decentralization` or link from main nav
  ↓
See current state (what's centralized now, in amber/red)
  ↓
See roadmap (quarterly milestones to full decentralization)
  ↓
Understand each component (provider network, scheduler, consensus, etc.)
```

---

### **Page: Decentralization Status**

**Route**: `/decentralization` or `/network/status`

**Purpose**: Build trust through transparency about current architecture and decentralization roadmap.

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  NETWORK DECENTRALIZATION STATUS                    │
│  "Bringing decentralized compute to everyone"       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Intro Card (hero section):                         │
│  ┌──────────────────────────────────────────────┐   │
│  │  Today: We run key services. You own your    │   │
│  │  hardware.                                    │   │
│  │                                              │   │
│  │  Roadmap: Community-run network by Q4 2025.  │   │
│  │  See the path below.                         │   │
│  │                                              │   │
│  │  [📖 Read the Vision] [🔗 Smart Contracts]  │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Decentralization Score (at top):                   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Current: ████░░░░░░ 42% Decentralized      │   │
│  │  Q4 2025: ████████░░ 80% Decentralized      │   │
│  │  Vision:  ██████████ 100% Decentralized     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Component Status Grid (cards, color-coded):        │
│  ┌────────────────┬────────────────────────────┐    │
│  │ PROVIDER       │ 🟢 DECENTRALIZED           │    │
│  │ NETWORK        │ Providers own hardware &   │    │
│  │                │ earnings. Network chooses  │    │
│  │                │ providers algorithmically. │    │
│  │                │ ✓ Live & proven           │    │
│  └────────────────┴────────────────────────────┘    │
│  ┌────────────────┬────────────────────────────┐    │
│  │ JOB SCHEDULER  │ 🟠 HYBRID                  │    │
│  │                │ Cloudana routes jobs to    │    │
│  │                │ providers. Roadmap: DAO    │    │
│  │                │ proposalsfor job types &   │    │
│  │                │ priorities (Q3 2025)       │    │
│  │                │ ⏳ In progress             │    │
│  └────────────────┴────────────────────────────┘    │
│  ┌────────────────┬────────────────────────────┐    │
│  │ REWARD         │ 🟠 HYBRID                  │    │
│  │ DISTRIBUTION   │ Smart contract calculates. │    │
│  │                │ Roadmap: community vote    │    │
│  │                │ on reward curves (Q2 2025) │    │
│  │                │ ⏳ In progress             │    │
│  └────────────────┴────────────────────────────┘    │
│  ┌────────────────┬────────────────────────────┐    │
│  │ CONSENSUS &    │ 🔴 CENTRALIZED             │    │
│  │ VERIFICATION   │ Cloudana validates proofs. │    │
│  │ (POUW)         │ Roadmap: migrating to      │    │
│  │                │ decentralized validators   │    │
│  │                │ (Q4 2025) — anyone can    │    │
│  │                │ verify                     │    │
│  │                │ ⏳ Planned                 │    │
│  └────────────────┴────────────────────────────┘    │
│  ┌────────────────┬────────────────────────────┐    │
│  │ GOVERNANCE     │ 🔴 CENTRALIZED             │    │
│  │ & PROTOCOL     │ Cloudana sets protocol     │    │
│  │ RULES          │ rules. Roadmap: CLDToken  │    │
│  │                │ holders vote on upgrades   │    │
│  │                │ (Q1 2026)                  │    │
│  │                │ ⏳ Planned                 │    │
│  └────────────────┴────────────────────────────┘    │
│                                                      │
│  Timeline (horizontal roadmap):                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  TODAY (Q1 2025)      │  Q2  │  Q3  │  Q4   │   │
│  │  ─────────────────────┼──────┼──────┼────── │   │
│  │  ✓ Provider Network   │      │      │       │   │
│  │    (decentralized)    │      │      │       │   │
│  │                       │      │      │       │   │
│  │  🟠 Reward Curves     │ DAO  │      │       │   │
│  │    Vote               │ vote │      │       │   │
│  │                       │      │      │       │   │
│  │  🟠 Job Scheduler     │      │ DAO  │       │   │
│  │    DAO Control        │      │ vote │       │   │
│  │                       │      │      │       │   │
│  │  🔴 POUW Validators   │      │      │ Decen │   │
│  │    Decentralized      │      │      │ validators
│  │                       │      │      │       │   │
│  │  🔴 Governance        │      │      │       │   │
│  │    Community Voting   │      │      │  Q1   │   │
│  │                       │      │      │  2026 │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Detailed Component Breakdown (expandable):         │
│                                                      │
│  [▶] PROVIDER NETWORK (Currently Decentralized)    │
│      ┌────────────────────────────────────────┐    │
│      │  Who owns hardware? YOU                │    │
│      │  Who picks which jobs run? Protocol    │    │
│      │  algorithm (no human in loop)          │    │
│      │  Who gets paid? Direct to your wallet  │    │
│      │  ✓ Fully decentralized                 │    │
│      │  ✓ Proven in production (500+ nodes)  │    │
│      │  📖 [Read provider docs]               │    │
│      └────────────────────────────────────────┘    │
│                                                      │
│  [▶] JOB SCHEDULER (Hybrid → Decentralized Q3)     │
│      ┌────────────────────────────────────────┐    │
│      │  Today: Cloudana matches jobs to       │    │
│      │  providers based on specs & price      │    │
│      │                                        │    │
│      │  Roadmap (Q3 2025):                    │    │
│      │  • Providers propose job categories    │    │
│      │  • CLD token holders vote on types     │    │
│      │  • Network enforces voted rules        │    │
│      │                                        │    │
│      │  Result: No Cloudana has final say     │    │
│      │  📖 [Read proposal]                    │    │
│      └────────────────────────────────────────┘    │
│                                                      │
│  [▶] CONSENSUS (POUW) — (Centralized → Q4 2025)   │
│      ┌────────────────────────────────────────┐    │
│      │  Today: Cloudana verifies jobs ran     │    │
│      │  correctly (Proof of Useful Work)      │    │
│      │                                        │    │
│      │  Roadmap (Q4 2025):                    │    │
│      │  • Any user stakes CLD to become       │    │
│      │    a validator                         │    │
│      │  • Validators check job proofs         │    │
│      │  • Slashing for bad behavior           │    │
│      │                                        │    │
│      │  Result: Permissionless validation     │    │
│      │  📖 [Read staking docs] [Stake Now]   │    │
│      └────────────────────────────────────────┘    │
│                                                      │
│  [▶] GOVERNANCE — (Centralized → Q1 2026)         │
│      ┌────────────────────────────────────────┐    │
│      │  Today: Cloudana sets protocol rules   │    │
│      │  (fee structure, hardware tiers, etc.) │    │
│      │                                        │    │
│      │  Roadmap (Q1 2026):                    │    │
│      │  • CLD holders vote on all rule        │    │
│      │    changes                             │    │
│      │  • Quadratic voting to prevent sybil   │    │
│      │  • Treasury controlled by DAO          │    │
│      │                                        │    │
│      │  Result: Community runs Cloudana       │    │
│      │  📖 [Read gov proposal]                │    │
│      └────────────────────────────────────────┘    │
│                                                      │
│  FAQ:                                               │
│  ❓ What happens if you disappear?                  │
│     → Smart contracts keep running. Validators      │
│     keep validating. Network keeps earning.         │
│     After Q4 2025, community votes on updates.      │
│                                                      │
│  ❓ Can I run my own validator?                     │
│     → Yes, starting Q4 2025. Stake 1000 CLD to     │
│     validate job proofs. Earn fees + rewards.      │
│                                                      │
│  ❓ Is my provider data safe?                       │
│     → Decentralized now. Your hardware, your       │
│     data. Cloudana never sees what jobs run.        │
│                                                      │
│  Feedback:                                          │
│  [📧 Suggest a roadmap priority] [🗣 Discord]      │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Components**:
- Intro card: primary color background, large text
- Decentralization score: progress bar (green for target, amber for current)
- Component status cards: `<Card>` with colored left border (red=🔴, amber=🟠, green=🟢)
- Timeline: horizontal swimlane with colored markers for milestones
- Expandable details: `<Collapsible>` with detailed explanation + links to docs/governance
- FAQ: shadcn `<Accordion>`
- CTA footer: link to Discord, feedback form, staking

**Color Scheme**:
- 🟢 Green (#10b981): Decentralized, live, proven
- 🟠 Amber (#f59e0b): Hybrid, in progress, roadmap approved
- 🔴 Red (#ef4444): Centralized today, planned decentralization

**Key Interactions**:
- Click component card to expand details
- Timeline markers are clickable → scroll to detailed section
- [Read proposal] links to GitHub, Litepaper, or governance docs
- [Stake Now] button in POUW section → routes to staking interface (future feature)

---

## Implementation Notes

### 1. Reusable Components (From Existing Codebase)

All proposals use existing Cloudana component library:

- **Cards & Layout**: `<Card>`, `<CardHeader>`, `<CardContent>` (shadcn)
- **Icons**: lucide-react (Server, Cpu, Zap, CheckCircle, Activity, etc.)
- **Inputs**: `<Input>`, `<Select>`, `<Slider>`, `<Textarea>` (shadcn)
- **Badges**: `<Badge>` with color variants (outline, secondary, etc.)
- **Tables**: `<Table>` with `<TableBody>`, `<TableCell>` (shadcn)
- **Modals**: `<Dialog>` or `<AlertDialog>` (shadcn)
- **Charts**: Recharts (used in pricing calculator; CPU/memory line charts are simple)
- **Status colors**: Green (#10b981), Yellow (#f59e0b), Red (#ef4444) from Tailwind

### 2. Existing Patterns to Reuse

- **Success state**: Green card with CheckCircle (from status.tsx)
- **Hardware specs layout**: LabelValue component (from providers/LabelValue.tsx)
- **Form multi-step**: Breadcrumb or custom progress indicator (from provider-register.tsx)
- **Cost estimates**: Info card with emoji icons + description (from pricing pages)
- **Transaction links**: TxLink component (from provider-register.tsx)
- **Status badges**: Green/amber/red from status.tsx

### 3. Routing & Navigation

Add to main navigation:

```
/provider/onboard        (new landing)
/provider/setup          (new setup flow)
/provider/complete       (new confirmation)
/provider/dashboard      (new ongoing dashboard)

/templates               (enhance existing)
/deployments/<id>        (enhance existing)
/deployments/deploy      (new config page)

/decentralization        (new transparency page)
```

### 4. Tone & Copy Guidelines

- **Provider flow**: Friendly, confidence-building, no jargon
  - "plug your hardware" not "deploy a node"
  - "start earning" not "get compensated for compute"
  - "active jobs" not "workloads"

- **Consumer flow**: Clear, technical enough for devs, brief
  - "Deploy & launch" not "register workload"
  - "live endpoint" not "deployment URL"
  - Logs + monitoring should feel like dev tools (dark background, monospace)

- **Decentralization page**: Honest, transparent, concrete dates
  - "Today: Cloudana runs this" not "This is decentralized"
  - "Roadmap: Q3 2025, community votes" with actual timeline
  - "Fully decentralized" only when proven/live

---

## Conclusion

These three flows—provider onboarding, consumer deploy, and decentralization transparency—form a cohesive UX narrative:

1. **Providers** see a simple "plug and earn" path that emphasizes ease and real-time earnings.
2. **Consumers** see a one-click "template → live" path that hides complexity.
3. **Everyone** sees Cloudana's commitment to decentralization through a transparent, honest roadmap.

All proposals use the existing design system (TailwindCSS, shadcn, lucide, React 19), reuse working patterns from the codebase, and focus on clarity over features.
