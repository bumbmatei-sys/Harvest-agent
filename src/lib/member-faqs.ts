/**
 * The FAQ shown to MEMBERS, on the Profile screen (FAQModal).
 *
 * ⚠️ WHY THIS FILE EXISTS — READ BEFORE ADDING AN ENTRY.
 *
 * The FAQ this replaced was written for a different product. It described a
 * consumer discipleship app: a four-level curriculum Harvest does not ship, a
 * "Church Partner Portal" that does not exist, an AI "locally trained" on
 * curated theology (it is retrieval over the tenant's own uploads), member
 * conversations used "to improve the accuracy" of the answers (the exact claim
 * removed from the privacy policy for being untrue), a funding story about
 * partners, and — most seriously — "100% free for the user", which contradicts
 * the pricing submitted to the payment processor for compliance review.
 *
 * Four features have shipped since that were described here before they
 * existed. This file is FAQ copy, but it is read as a statement of what the
 * product does, so it is held to the same standard as the policies:
 *
 *   1. EVERY ANSWER MUST BE VERIFIABLE IN THE CODEBASE. Not on the roadmap,
 *      not "how it will work" — what the code does today. Each entry below
 *      carries a `sources` list naming the files it was checked against. If
 *      you cannot name one, the answer does not go in.
 *   2. NOTHING ABOUT PRICE, PLANS, TRIALS, BILLING OR REFUNDS. A member has no
 *      subscription and never pays Harvest anything, so these are not just
 *      off-topic, they are misleading — the reader would conclude the charge
 *      is theirs. `member-faqs.test.ts` fails the build on a price or a plan
 *      name. Those questions belong to theharvest.site.
 *
 * The audience is a member using their ministry's workspace. Not a buyer.
 *
 * Copy convention (AGENTS.md): "ministry", not "church".
 */

export interface MemberFAQ {
  question: string;
  /** Rendered in order, one paragraph each. Plain strings — no markup. */
  answer: string[];
  /**
   * Files this answer was verified against. Not rendered; it exists so the
   * next person to edit an answer knows where to re-check it, and so that
   * "I could not verify this" is a visible state rather than a silent one.
   */
  sources: string[];
}

export const MEMBER_FAQS: readonly MemberFAQ[] = [
  {
    question: 'How do I get into my ministry on Harvest?',
    answer: [
      'Every ministry has its own address — usually its name in front of theharvest.app, sometimes a domain of its own. That address is the ministry’s workspace, and you get in by opening the link your ministry gave you and creating your account there.',
      'There is no global directory that will find your ministry for you, so if you do not have the link, ask whoever runs the ministry for it.',
      'The address you sign up on is what ties your account to that ministry. That tie is set once, when the account is created, and cannot be changed from inside the app afterwards.',
    ],
    // AuthPage derives tenantId from the hostname (not spoofable, cookie
    // fallback for custom domains) and stamps it on users/{uid} at creation;
    // firestore.rules makes `tenantId` immutable on both self-edit and admin
    // edit, so membership genuinely cannot move from inside the app.
    sources: ['src/components/AuthPage.tsx', 'firestore.rules'],
  },
  {
    question: 'Why can I not see something another member can?',
    answer: [
      'Harvest is one app, but not all of it is switched on for every ministry. Chat and Map are turned on by the plan the ministry runs on — where a ministry does not have them, those tabs are absent rather than empty. Courses appears only once your ministry has published at least one course. Prayer, Give and the Bible are there for everyone.',
      'Other screens are for the people who run the ministry rather than for members: the admin dashboard and everything under it.',
      'So a missing tab is one of three things — the ministry’s plan does not include it, nothing has been published yet, or it is not a member screen. Your ministry’s admin can tell you which, and is the only person who can change it.',
    ],
    // MainApp builds both tab rows from the resolved plan: blog/aiChat/map are
    // `features?.X === true` gates, Courses is `coursesStatus === 'present'`,
    // Prayer and Give are unconditional.
    sources: ['src/components/MainApp.tsx', 'src/utils/plan-features.ts'],
  },
  {
    question: 'How does giving work, and who receives the money?',
    answer: [
      'Give sends your gift to your ministry’s own payment account, through Stripe’s checkout. You can give once, or set up a gift that repeats monthly.',
      'The money goes to the ministry, not to Harvest. The whole amount lands in the ministry’s account with nothing taken out by the platform, and Harvest never holds it. Your card details go to Stripe and are not stored by Harvest.',
      'A record of what you have given to this ministry is under Profile. If Give tells you the ministry has not set up payments yet, that is setup the ministry still has to finish — there is nothing wrong with your account.',
    ],
    // /api/stripe/donate creates a destination charge: transfer_data.destination
    // is the tenant's own connected account, and PLATFORM_FEE_MAP is 0 on every
    // tier, so application_fee_amount is 0. The "not set up payments yet" copy
    // is the route's own 400 when the tenant has no connected account.
    sources: [
      'src/app/api/stripe/donate/route.ts',
      'src/lib/stripe-connect.ts',
      'src/components/DonationHistory.tsx',
    ],
  },
  {
    question: 'What is the Chat assistant, and where do its answers come from?',
    answer: [
      'Chat — which carries your ministry’s name at the top — answers out of material your ministry has uploaded. Its admins add documents to a knowledge base; when you ask something, your question is matched against those documents and the closest passages are handed to a language model, which writes the reply from them.',
      'That is the whole mechanism: a search across your ministry’s own content, then an answer written from what the search found. It is not a model that has been trained or tuned on that material, and nothing you type is used to train it or to change how it answers anyone else. When nothing relevant turns up, it says so and points you to your admin instead of inventing an answer.',
      'It also paces itself. After around ten messages it will ask you to pause, and shortly after that it rests for a few hours before picking up again.',
    ],
    // AIChat.searchVectorDB embeds the query (Gemini gemini-embedding-001) and
    // scores it against rag_chunks filtered to the tenant, keeping the top 5
    // above 0.5 similarity; those become context for a MiMo mimo-v2.5
    // completion. Admins populate rag_chunks via AdminRAG. The route persists
    // counters only (chat_usage/{uid}: windowCount, cooldownUntil,
    // lastMessageAt) — never message text. 10 messages, then a redirect
    // window, then a 3h cooldown.
    sources: [
      'src/components/AIChat.tsx',
      'src/app/api/gemini/route.ts',
      'src/lib/ai-config.ts',
      'src/components/AdminRAG.tsx',
    ],
  },
  {
    question: 'Where does my course progress go?',
    answer: [
      'Onto your account, not onto the device you happen to be using. Lessons you mark complete, your quiz attempts and the notes you write on a lesson are saved against your profile as you go, so signing in somewhere else picks up where you left off.',
      'If your ministry issues a certificate for a course, the app does not get to decide you have finished — the server re-checks your saved lessons and quiz results before it will issue one.',
    ],
    // CoursePage reads and writes completedLessons / quizAttempts / lessonNotes
    // on users/{uid}; /api/certificate re-derives completion from that same
    // document server-side rather than trusting the client's claim.
    sources: ['src/components/CoursePage.tsx', 'src/app/api/certificate/route.ts'],
  },
  {
    question: 'Who can see my information?',
    answer: [
      'You, and the admins of your own ministry. Everything held against your account — your name, email, course progress and the rest — is scoped to the ministry you belong to, and admins of other ministries cannot reach it. Harvest’s own operators can also reach it, which is what lets them run and repair the service.',
      'Chat is the exception. Your conversations stay in your browser on the device you used them on, and the server keeps only a count of how many messages you have sent — never what was in them. Clearing your browser data clears that history.',
      'What Harvest collects, why, and how long it is kept is set out in the Privacy Policy, linked from Profile under Privacy & Terms.',
    ],
    // firestore.rules users/{userId}: read is self, isSuperAdmin(), or
    // isTenantAdmin(resource.data.tenantId) — so own-ministry admins only.
    // AIChat keeps conversations in localStorage ('harvest_ai_chats'); the
    // server side of chat writes chat_usage counters and no content.
    sources: [
      'firestore.rules',
      'src/components/AIChat.tsx',
      'src/app/api/gemini/route.ts',
      'src/lib/legal-links.ts',
    ],
  },
  {
    question: 'How do I leave, or delete my account?',
    answer: [
      'Profile, then Personal Information, then Delete Account. That removes your profile and your sign-in. It takes effect immediately and cannot be undone.',
      'If nothing appears to happen, sign out, sign back in and try again — the deletion only goes through for an account that has signed in recently.',
      'There is no way to move an existing account to a different ministry, because that tie is fixed when the account is created. Joining another ministry means creating an account at that ministry’s address. If you would rather come off your ministry’s lists and keep your sign-in, ask an admin — removing a member’s record is something they can do.',
    ],
    // PersonalInformationModal.handleDeleteAccount deletes users/{uid} and then
    // the Firebase Auth user; Firebase rejects it with
    // 'auth/requires-recent-login' on a stale session. Admins remove a member
    // record from the Roles screen (AnalyticsAndRoles.confirmDeleteUser).
    sources: [
      'src/components/PersonalInformationModal.tsx',
      'src/components/AnalyticsAndRoles.tsx',
      'firestore.rules',
    ],
  },
] as const;
