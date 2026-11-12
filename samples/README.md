# Voice Agent samples

Choose a sample to learn how to create, connect, and extend a Foundry Voice
Agent. This directory includes Python, C#, Java, browser, and end-to-end
application samples, plus a design guide.

Start with the sample's linked documentation for its prerequisites, supported
regions, model choices, and run commands. The [common Python setup](#common-python-sample-setup)
below applies to the top-level Python scripts; directory-based samples may have
their own dependencies and setup.

For the general browser UI, use the local
[`portal/`](../portal/README.md). For the Finance CLI samples and the
independent shared MCP reference implementation, start with the
[Finance documentation index](../docs/README.md).

**Default Portal Templates use the public no-auth MCP.** Local MCP hosting,
Dev Tunnel, `setup-local-examples.sh`, and local E2E are optional development
paths, not prerequisites for browsing, publishing, or trying Templates.
Finance CLI examples have separate managed-MCP configuration requirements;
an existing customer-hosted MCP does not need a local tunnel.

## Choose a sample

Choose by **the use case you want to show**, then open the project link for
setup, model choices, and an example conversation. The tables distinguish the
caller's goal from what actually happens in the demonstration.

| Sample | What it demonstrates |
| --- | --- |
| [Haier Voice Home](haier-voice-home/README.md) | Source-buildable bilingual smart-home experience with Foundry Voice Agents, locally executed simulated-device tools, grounded product knowledge, Classic/Modern/Habitat UIs, portable Realtime/Mini configuration, and a separate WebRTC latency lab. Setup and architecture documentation are in Chinese. |
| [Voice Agent Cost Lab](../tools/cost_calculator/README.md) | Standalone browser list-price calculator in `tools`: South India model prices, labeled Central India HD/Voice Live references, managed/BYOM model selection, prompt sensitivity, and CSV export. No Azure credentials required. |
| [Add voice to an existing customer agent](existing_agent_voice_design/README.md) | Design guide: use a Hosted Agent as the Foundry Voice Agent conversation engine to connect managed voice to an existing customer agent or API endpoint. Includes a high-level architecture diagram; not a runnable sample. |
| [Google ADK with an existing Voice Agent](adk_voice_agent/README.md) | One ADK live-audio application with configuration-only selection of Gemini Live or an existing Foundry Voice Agent, SDK transport, PCM resampling, transcripts, interruption handling, and offline tests. |
| [Voice Live to Voice Agent migration](voice_live_to_voice_agent/README.md) | Compare the same Azure Speech -> GPT-4.1 mini -> Azure TTS cascade and shared local functions before and after migration. Includes dynamic session context and mid-session instruction-update examples. |
| [Voice Agent with image and camera input](voice_agent_image_input/README.md) | Send text, uploaded images, or sampled camera frames as `input_image` parts and hear the answer. Includes a loopback web UI, a latency-measuring CLI, a bounded camera-frame window, sizing guidance, and direct-vs-separate-vision integration patterns. |
| [Vehicle voice agent with local tools](vehicle_local_tools/README.md) | Web cockpit with cloud voice interaction and locally executed simulated climate, media, and navigation functions. Includes an offline dashboard, local policy enforcement, and a tool execution log. |
| [Long tool waits with spoken reminders](long_tool_wait/README.md) | Keep callers informed during slow local tools using out-of-band Voice Agent speech, with both GPT Realtime and an Azure Speech / GPT-5.4 pipeline. |
| [Language learning with pronunciation assessment](language_learning/README.md) | Have a hands-free conversation with a voice coach that asks you to read specified sentences, then gives per-sentence and word-level feedback through an Azure Speech Pronunciation Assessment function tool. Supports spoken retries and a WAV-file mode. |
| [Spoken identifiers with digit recognition](digit_recognition/README.md) | Use the server-managed `digit_recognition` tool with GPT Realtime and MAI Transcribe 2, silent tool calls, digit-by-digit readback, and caller confirmation. Includes language selection and an explicit Azure Speech alternative. |
| [Realtime STT agent](realtime_stt/README.md) | Create or reuse a voice-first agent with VAD, disabled LLM responses, MAI Transcribe 2 or Azure Speech, microphone or paced WAV input, and final usage collection with explicit completeness status. |
| [Agent-based transcript refinement, summary, and translation](audio_transcribe_and_translate/README.md) | Transcribe a WAV recording with mai-transcribe-2 and process it with a gpt-5.4 Voice Agent. Includes refinement and translation modes, guidance for adapting the instructions to summarization, and a 60-second input limit. Supports native Windows PowerShell. |
| [Knowledge, Andrew Dragon HD, and Harry Business](create_agent_with_iq_avatar_voice/README.md) | Portal creation is recommended; optional Python validation/create/readback is included. Supports optional custom photo avatar and Personal Voice workflows. |
| [Scenario-driven conversation simulation and evaluation](simulation_evaluation/README.md) | Use Foundry's cloud simulation API to generate adaptive conversations from user goals, score task completion and coherence, and preserve results. Text by default; optional cloud voice configuration requires a supported target/project. |
| [Foundry evaluation with a custom rubric](foundry_evaluation/README.md) | Illustrated airline refund-eligibility evaluation tutorial, reported two-stage simulation/transcript-grading workflow, and a preliminary Python runner with documented live compatibility issues. |
| [`simple_rest_lifecycle.py`](simple_rest_lifecycle.py) | Create a simple Agent with REST, or retrieve an existing Agent. |
| [`basic_voice_agent.py`](basic_voice_agent.py) | Create and version a basic Agent, or connect to an existing Agent, then converse through the microphone. |
| [Create, converse, and evaluate](conversation_evaluation/README.md) | Create one stored Voice Agent and run four three-turn sessions with real audio input/output; evaluate actual spoken transcripts, compare successful and deliberately failed tasks, and export WAVs/results with bounded polling and persistence checks. |
| [Data Zone and regional realtime Voice Agents](realtime_datazone_voice_agent.md) | Create or reuse a voice-first Agent with an explicit managed model and hands-free microphone conversation. See the sample guide for region/model combinations and routing prerequisites. |
| [Foundry GPT Live with Responses delegation](gpt_live/python/README.md) | Create an English-teacher agent or reuse `AGENT_NAME`, stream microphone audio with Responses delegation, and print the conversation ID and download command after close. |
| [SIP Voice Agent with GPT Live](sip_voice_agent/README.md) | Create a GPT Live Agent with direct model Responses delegation, create or reuse a SIP inbound Connection, bind it, inspect call records, and remove test routing. Includes digest/IP ACL setup and offline tests. |
| [Foundry GPT Live with managed prompt-agent delegation](gpt_live/python/README.md#managed-prompt-agent-delegation) | Create a prompt agent first, pin its version to a new GPT Live voice agent, then stream microphone audio with Foundry-managed delegation. |
| [Foundry GPT Live with prompt-agent tools](gpt_live/python/README.md#managed-prompt-agent-with-mcp-and-local-function-tools) | Give the managed prompt agent an MCP addition calculator and a local current date/time function. |
| [Foundry GPT Live with client delegation](gpt_live/python/README.md#client-delegation) | Make the app GPT Live's backend: it answers delegated time and addition questions on the Live session with thinking and commentary. Every GPT Live sample greets the learner by name using structured inputs. |
| [Foundry GPT Live in the browser](gpt_live/js/README.md) | Talk to the same English teacher from a browser with your microphone, with Responses, managed prompt-agent (MCP calculator and local date/time function), or client delegation, and a greeting personalized by structured inputs. The page opens the Live session directly with the preview `@azure/ai-projects` package; a small Node.js server creates the agents and gives the page an access token. |
| [`voice_agent_with_mcp.py`](voice_agent_with_mcp.py) | Create an MCP Agent, converse through the microphone, and display tool arguments and output. |
| [`voice_agent_with_foundry_iq.py`](voice_agent_with_foundry_iq.py) | Create a Foundry IQ Agent, converse through the microphone, and display tool activity. |
| [`voice_agent_with_local_function.py`](voice_agent_with_local_function.py) | Execute `add_numbers` in the client, return its output, and hear the response. |
| [`voice_agent_with_toolbox.py`](voice_agent_with_toolbox.py) | Create a Toolbox Agent, converse through the microphone, and display tool activity. |
| [Documentation-generated voice web sample](foundry_voice_webrtc/README.md) | Connect a browser to an existing voice Agent with generally available WebSocket or WebRTC transports; standalone Python backend, Azure CLI authentication, and Azure session storage enabled. |
| [Turn detection: speech start and end of utterance](turn_detection/README.md) | Keep backchannels such as "mm-hm" from interrupting the agent with `speech_start_detection`, and wait through mid-sentence pauses with the `microsoft-decision-1` end-of-utterance model. Talk through the microphone and watch which speech takes the turn. |
| [Inline subagent handoff](handoff_example/README.md) | Create a voice agent with front-desk, scheduling, and closing inline subagents using typed SDK models, then talk through the microphone and watch each handoff event. Complete code for the Learn article on inline subagents. |
| [Basic prompt subagent](subagent/voice_subagent_prompt_basic/README.md) | Create a poetry prompt subagent and a voice agent that delegates poem writing to it. |
| [Hosted GitHub Copilot subagent](subagent/voice_subagent_hosted_agent/README.md) | Create a voice agent that delegates research, learning, and coding tasks to an existing hosted GitHub Copilot agent. |
| [Finance with Handoff - Realtime](example1_finance_with_handoff_realtime/README.md) | Finance graph on the Realtime pipeline (`gpt-realtime-regional`) with a text Voice WebSocket CLI. |
| [Finance with Handoff - Cascade](example1_finance_with_handoff_cascade/README.md) | Finance graph on the Cascade pipeline (`gpt-4.1-mini`, Azure Speech) in its own directory, with its own CLI. |
| [Finance with Handoff - Realtime, Hindi](example1_finance_with_handoff_realtime_hi_in/README.md) | Independent `hi-IN` input/output version using GPT Realtime, Azure Speech, and Swara, with English business instructions. |
| [Finance with Handoff - Cascade, Hindi](example1_finance_with_handoff_cascade_hi_in/README.md) | Independent `hi-IN` input/output version using GPT-4.1 mini, Azure Speech, and Swara, with English business instructions. |
| [Finance with OTP and Officer Search](example2_finance_with_OTP_and_Officer_Search/README.md) | Publish a flat Finance Agent for OTP verification and loan-officer search, then run a text smoke test. |
| [Elevator Service with Safety, Zendesk, and Handoff](example3_elevator_service_with_safety_zendesk_and_handoff/README.md) | Publish an inbound field-service graph with deterministic safety checks, explicit Zendesk ticket confirmation, exact-ID status queries, and human-assistance routing. |
| [Front Desk with Fluency and Handoff](example4_frontdesk_with_fluency_and_handoff/README.md) | Load a response-first receptionist Template with company FAQ, grounded support search, honest transfer fallback, and callback-message persistence only after explicit confirmation. |
| [Customer Support with Handoff](example5_customer_support/README.md) | Run a support graph with staged handoff, spoken transfer messages, one-step troubleshooting, and an unsubmitted follow-up summary. |
| [Appointment Setter with Handoff](example6_appointment_setter/README.md) | Run a appointment graph that qualifies interest, collects proposed meeting times, and reads back a meeting request without booking it. |
| [Receptionist and Messaging with Handoff](example7_receptionist_messaging/README.md) | Run a front desk graph that answers company questions from sample facts, routes callers to a directory entry, and reads back a message for follow-up without sending it. |
| [Appointment Scheduler with Handoff](example8_appointment_scheduler/README.md) | Run a scheduling graph that captures new, reschedule, and cancel requests for a sample clinic and reads them back without booking or changing anything. |
| [Assessment and Quiz with Handoff](example9_assessment_quiz_agent/README.md) | Run a quiz graph that asks 10 security awareness questions one at a time and branches to a pass or needs-work debrief. |
| [Collections and Payment Recovery with Handoff](example10_collections_payment_recovery_agent/README.md) | Run a outbound collections graph that verifies the holder, explains a past-due balance, and captures a payment arrangement or hardship request for follow-up. |
| [Corporate Training Role-Play Coach with Handoff](example11_corporate_training_roleplay_coach/README.md) | Run a role-play graph that stays in character for a tough workplace conversation and then switches to a scored coaching debrief. |
| [Education and Tutoring with Handoff](example12_education_tutoring/README.md) | Run a tutoring graph that assesses the student, branches to fundamentals or advanced exploration, practices problems, and wraps up without booking a session. |
| [Healthcare Receptionist with Handoff](example13_healthcare_receptionist/README.md) | Run a medical front desk graph that captures appointment and change requests for a sample practice and routes emergencies to 911 without booking anything. |
| [Hotel Reservations with Handoff](example14_hotel_reservation_agent/README.md) | Run a hotel graph that quotes sample room rates, takes reservation and change requests for the front desk, and answers amenity questions. |
| [Inbound Lead Qualifier with Handoff](example15_inbound_lead_qualifier/README.md) | Run a BANT qualification graph that routes hot leads to a meeting request and others to a nurture follow-up without booking or creating records. |
| [Incident Response Coordinator with Handoff](example16_incident_response_coordinator/README.md) | Run a incident triage graph that classifies severity and prepares page or ticket details that someone must send manually. |
| [Insurance Advisor with Handoff](example17_insurance_advisor/README.md) | Run a insurance graph that explores coverage, explains typical ranges, captures an application for a licensed agent, and redirects claims. |
| [Internal Knowledge Assistant with Handoff](example18_internal_knowledge_assistant/README.md) | Run a internal Q&A graph that routes factual, multi-step, and unknown questions and notes documentation gaps without searching or filing anything. |
| [IT Access Request Agent with Handoff](example19_it_access_request_agent/README.md) | Run a access-request graph that classifies requests as standard, manager approval, or restricted and reads back the request without filing it. |
| [IT Help Desk with Handoff](example20_it_help_desk_internal_support/README.md) | Run a IT help desk graph that troubleshoots one step at a time and reads back an escalation without filing a ticket. |
| [Language Practice Tutor with Handoff](example21_language_practice_tutor/README.md) | Run a language practice graph that branches by level and recaps the session without booking the next one. |
| [Legal Intake Specialist with Handoff](example22_legal_intake_specialist/README.md) | Run a legal intake graph that screens emergencies and out-of-scope matters, collects case facts, and captures a consultation request without saving or booking it. |
| [Marketing Lead Capture with Handoff](example23_marketing_lead_capture_agent/README.md) | Run a lead-capture graph that routes hot leads to a sales-call request and others to a resource follow-up without booking or sending anything. |
| [New Hire Onboarding Assistant with Handoff](example24_new_hire_onboarding_assistant/README.md) | Run a onboarding graph that branches by role, covers benefits, and shares key contacts without booking a 1:1 or sending a text. |
| [Order Status and Tracking with Handoff](example25_order_status_tracking/README.md) | Run a order support graph that gives shipping timelines, captures return requests, and notes warranty claims without logging or texting anything. |
| [Outbound Sales Representative with Handoff](example26_outbound_sales_representative/README.md) | Run a outbound sales graph with a permission-based opener, objection handling, and a demo request that is not booked. |
| [Personal Voice Assistant with Handoff](example27_personal_voice_assistant/README.md) | Run a assistant graph that answers from sample facts, reads back notes, and identifies the right team without emailing or filing anything. |
| [Real Estate Lead Follow-Up with Handoff](example28_real_estate_lead_follow_up/README.md) | Run a real estate graph that qualifies a buyer, discusses sample listings, and captures showing or information requests without booking or sending anything. |
| [Restaurant Phone Order Taker with Handoff](example29_restaurant_phone_order_taker/README.md) | Run a order-taking graph that branches by pickup or delivery and reads back the order with its total without texting a summary. |
| [Salon and Spa Receptionist with Handoff](example30_salon_spa_beauty_receptionist/README.md) | Run a salon graph that answers menu questions and captures appointment requests without booking or texting. |
| [Survey and Feedback Intake with Handoff](example31_survey_feedback_intake/README.md) | Run a outbound survey graph that asks consent, runs four questions one at a time, and reads the answers back without saving them. |
| [Technical Support Agent with Handoff](example32_technical_support_agent/README.md) | Run a technical support graph that troubleshoots one step at a time and reads back an escalation without filing a ticket. |
| [Travel Agency Trip Planner with Handoff](example33_travel_agency_trip_planner/README.md) | Run a trip planning graph that recommends sample packages with ballpark pricing and captures a trip request without booking it. |
| [User Research Interviewer with Handoff](example34_user_research_interviewer/README.md) | Run a interview graph that branches on available time between a deep dive and priority questions and recaps the answers. |
| [Conference Concierge (Ignite 2026)](example35_conference_concierge/README.md) | Find sessions, get recommendations, build an agenda with clash checks, hear what is starting now and official room changes, and get FAQ and on-site logistics answers in any language, on the stateless conference MCP pack with the live public catalog, the official FAQ, and the event guide. |
| [Multi-Stage OTP Verification Showcase](example36_multi_stage_otp_verification_showcase/README.md) | Run a bank graph that steps assurance up from name and birthday to an access code to a text-message code, with the MCP backend gating each level. |
| [Ignite Session Planner](ignite_planner/README.md) | Run a browser page whose voice Agent operates the page through client-executed functions: it ranks, highlights and compares Ignite 2026 sessions, finds speakers by sound, and builds an agenda. |
| [C# voice agent sample](CSharp/README.md) | Create and manage a temporary Agent or use an existing Agent, stream audio over WebSocket, and read persisted conversations and recordings. |
| [Java live audio Voice Agent sample](java/README.md) | Create a temporary Agent and run an asynchronous microphone and speaker conversation with Enter-to-end, barge-in, persisted conversation readback, and cleanup. |
| [`download_conversation_artifacts.py`](download_conversation_artifacts.py) | Download conversation JSON, per-turn WAV files, and the merged stereo WAV. |
| [`download_conversation_traces.py`](download_conversation_traces.py) | Download correlated Application Insights rows by conversation ID. |

For a mobile customer presentation or a general-purpose browser conversation,
start with **First Voice**. For industry workflows in the Portal, use the
numbered business templates below.

- [Browser, mobile, and multimodal experiences](#browser-mobile-and-multimodal-experiences)
- [Banking, support, and reception](#banking-support-and-reception)
- [Sales, appointments, and travel](#sales-appointments-and-travel)
- [Employee services, learning, and research](#employee-services-learning-and-research)
- [Developer building blocks and integrations](#developer-building-blocks-and-integrations)
- [Transcription, evaluation, and operations](#transcription-evaluation-and-operations)

**Demo boundaries:** Examples 5-34 use mock tools with fictional results on the
public no-auth `/mcp/mock-tool-call` route by default. They can demonstrate
booking, messaging, or ticket creation, but nothing is booked, sent, charged,
or filed in a real business system. Use fictional information only. Other
samples have their own integration requirements and limitations, noted below
and in their READMEs. To connect actual systems, see
[Connect real tools](../docs/05_connect_real_tools.md).

In the business templates, **handoff** normally means moving between stages
of the agent's workflow, not transferring a telephone call to a person.
Actual phone transfer requires a supporting telephony runtime.

### Browser, mobile, and multimodal experiences

| Sample project | Demo use case | What you will see or hear |
| --- | --- | --- |
| [First Voice: browser voice assistant](foundry_voice_webrtc/README.md) | A visitor wants to try a natural, interruptible voice conversation on mobile or desktop. | Creates or reuses a saved agent; includes fictional health, banking, connected-home, personal-loan, home-buying and job-interview scenarios, plus microphone and text input, spoken replies, transcripts, model/voice controls, and conversation downloads over WebSocket or WebRTC. |
| [GPT Live browser English teacher](gpt_live/js/README.md) | A learner wants to practise English by speaking with an AI teacher. | A browser conversation backed by GPT Live and a Responses model or managed prompt agent. The managed-agent mode also demonstrates calculator and date/time tools. |
| [Vehicle voice cockpit](vehicle_local_tools/README.md) | A driver wants to change cabin temperature, adjust music volume, or start navigation by voice. | A web dashboard updates simulated vehicle settings. The cloud agent chooses actions, but local code validates and executes them; no physical vehicle is controlled. |
| [Voice with image and camera input](voice_agent_image_input/README.md) | A user wants to show an image or camera view and ask a question about it. | Upload an image or send sampled camera frames, ask a question, and hear an answer. Includes a local web UI and a latency-measuring CLI. |
| [Pronunciation coach](language_learning/README.md) | A language learner wants feedback on how they pronounce a sentence. | The coach asks the learner to read aloud, uses Azure Speech Pronunciation Assessment, explains sentence- and word-level feedback, and offers spoken retries. |
| [Knowledge, voice, and avatar agent](create_agent_with_iq_avatar_voice/README.md) | A user wants to ask questions of a knowledge-grounded assistant with a chosen voice and avatar. | A portal-first setup combining Foundry IQ, Andrew Dragon HD voice, and Harry Business avatar, with optional custom photo avatar and Personal Voice workflows. |
| [Conference concierge: Ignite 2026](example35_conference_concierge/README.md) | An attendee wants relevant sessions, a clash-free agenda, and help finding event information. | Session recommendations, agenda checks, and answers grounded in the official catalog, FAQ, and event guide. No calendar or email integration; this sample requires its own conference MCP setup. |

### Banking, support, and reception

| Sample project | Demo use case | What the demo does |
| --- | --- | --- |
| [1: Finance - Realtime](example1_finance_with_handoff_realtime/README.md) | A lender calls a customer to discuss a personal-loan offer. | Walks through identity checks, indicative offer negotiation, charge disclosure, credit-bureau consent, and a loan-officer appointment using a realtime speech pipeline. |
| [1: Finance - Cascade](example1_finance_with_handoff_cascade/README.md) | Show the same loan conversation with separate speech recognition, language model, and speech synthesis. | Runs the same business stages using GPT-4.1 mini and Azure Speech, including spoken acknowledgments during slower operations. |
| [1: Finance - Realtime, Hindi](example1_finance_with_handoff_realtime_hi_in/README.md) | A Hindi-speaking customer discusses a personal-loan offer. | Preserves the Realtime finance workflow with Hindi input/output and the Swara voice. |
| [1: Finance - Cascade, Hindi](example1_finance_with_handoff_cascade_hi_in/README.md) | Show the Hindi loan conversation with a cascaded speech pipeline. | Preserves the Cascade finance workflow with Hindi input/output and the Swara voice. |
| [2: Finance with OTP and officer search](example2_finance_with_OTP_and_Officer_Search/README.md) | A customer verifies a test access code, discusses borrowing, and chooses a loan officer. | Demonstrates OTP verification, loan calculation, interest capture, officer lookup, and callback confirmation in one agent rather than a multi-stage handoff graph. |
| [3: Elevator service](example3_elevator_service_with_safety_zendesk_and_handoff/README.md) | A caller reports faulty elevator doors or asks about an existing service ticket. | Performs five safety checks, reviews the issue with the caller, creates a mock Zendesk ticket only after confirmation, and looks up tickets by exact ID. |
| [4: Front desk with fluency](example4_frontdesk_with_fluency_and_handoff/README.md) | A caller asks about the company, needs support, or wants to leave a callback message. | Answers FAQs, attempts grounded support search, and saves a confirmed callback message through the demo service. Browser calls offer a message instead of pretending to transfer; saving does not guarantee delivery. |
| [5: Customer support](example5_customer_support/README.md) | A customer needs help with a product problem or an account question. | Uses mock help articles and CRM lookup, troubleshoots one step at a time, and creates a new mock support ticket after approval. No refund or account-plan change. |
| [7: Receptionist and messaging](example7_receptionist_messaging/README.md) | A caller wants to reach an employee or leave a message. | Answers company questions, checks mock staff availability, and demonstrates SMS or email follow-up to a directory contact. |
| [10: Collections and payment recovery](example10_collections_payment_recovery_agent/README.md) | A lender discusses a past-due balance with a customer who may need more time or hardship support. | Captures an arrangement or hardship request, finds a mock follow-up contact, and simulates a confirmation text. No payment is taken. |
| [17: Insurance advisor](example17_insurance_advisor/README.md) | A customer wants to explore coverage and discuss an application with an adviser. | Explores needs and sample coverage, looks up a mock contact, and simulates booking an application-review call. |
| [25: Order status and tracking](example25_order_status_tracking/README.md) | A shopper asks where an order is or wants help with a return or warranty issue. | Uses a mock order lookup and demonstrates logging return details on a support ticket and texting a summary. |
| [32: Technical support](example32_technical_support_agent/README.md) | A cloud-product customer reports a technical fault that may need escalation. | Searches mock help articles, checks a mock contact, guides troubleshooting, and demonstrates ticket creation or a comment on an existing ticket. |

### Sales, appointments, and travel

All business-system actions in this table use mock tools by default.

| Sample project | Demo use case | What the demo does |
| --- | --- | --- |
| [6: Appointment setter](example6_appointment_setter/README.md) | A sales team follows up a warm lead and offers a product demo. | Qualifies interest, finds an available time, simulates a 30-minute Teams booking, and creates a mock CRM lead. |
| [8: Appointment scheduler](example8_appointment_scheduler/README.md) | A clinic caller wants to book, move, or cancel a visit. | Demonstrates availability lookup and mock calendar creation, rescheduling, or cancellation. |
| [13: Healthcare receptionist](example13_healthcare_receptionist/README.md) | A patient needs help arranging a visit or changing an appointment. | Simulates booking a visit or filing a change request for the front desk, with emergency redirection. Does not provide medical advice. |
| [14: Hotel reservations](example14_hotel_reservation_agent/README.md) | A guest wants to check rooms, arrange a stay, or change a reservation. | Answers hotel questions and uses mock availability, reservation lookup, creation, and cancellation tools. No real room is reserved or charged. |
| [15: Inbound lead qualifier](example15_inbound_lead_qualifier/README.md) | An interested prospect asks whether a product fits their business. | Qualifies budget, decision authority, needs, and timing; then demonstrates a mock meeting invite and CRM lead capture. |
| [22: Legal intake](example22_legal_intake_specialist/README.md) | A prospective client wants to explain a matter and request a consultation. | Screens the request, collects case facts, and simulates saving an intake lead and booking a consultation. Use fictional case details. |
| [23: Marketing lead capture](example23_marketing_lead_capture_agent/README.md) | A campaign respondent wants more information or a sales conversation. | Captures interest, checks a mock contact, creates a mock lead, and simulates a sales-call booking. |
| [26: Outbound sales](example26_outbound_sales_representative/README.md) | A sales representative calls a prospect to introduce a product and offer a demo. | Uses a permission-based opener, handles objections, and demonstrates mock calendar booking and CRM follow-up. |
| [28: Real estate lead follow-up](example28_real_estate_lead_follow_up/README.md) | A prospective buyer wants to discuss properties and arrange a viewing. | Qualifies preferences, discusses sample listings, and demonstrates a mock showing invite and lead capture. |
| [29: Restaurant phone orders](example29_restaurant_phone_order_taker/README.md) | A diner wants to assemble a pickup or delivery order. | Reads back items and a total, with an optional mock summary text. The order remains unsubmitted: it is not sent to or accepted by a kitchen, and no payment is taken. |
| [30: Salon and spa receptionist](example30_salon_spa_beauty_receptionist/README.md) | A customer asks about services and wants an appointment. | Answers menu questions, finds a mock appointment slot, and demonstrates booking and an optional SMS reminder. |
| [33: Travel agency trip planner](example33_travel_agency_trip_planner/README.md) | A traveler wants holiday ideas that fit their preferences and budget. | Discusses sample packages and ballpark prices, then creates a mock trip-request lead. Does not book travel, take payment, or email an itinerary. |

### Employee services, learning, and research

All business-system actions in this table use mock tools by default.

| Sample project | Demo use case | What the demo does |
| --- | --- | --- |
| [9: Assessment and quiz](example9_assessment_quiz_agent/README.md) | An employee takes a spoken security-awareness quiz. | Asks ten questions one at a time, provides a pass or needs-work debrief, and simulates saving the score with consent. |
| [11: Corporate role-play coach](example11_corporate_training_roleplay_coach/README.md) | A trainee wants to practise a difficult workplace conversation. | Role-plays the other person, switches to a scored coaching debrief, and simulates saving the results after agreement. |
| [12: Education and tutoring](example12_education_tutoring/README.md) | A student wants help understanding a topic and practising problems. | Adjusts to the student's level, teaches step by step, and demonstrates a mock follow-up session booking. |
| [16: Incident response coordinator](example16_incident_response_coordinator/README.md) | An employee reports an incident that may need urgent attention. | Classifies severity, simulates paging the on-call person or notifying an owner, and creates a mock incident ticket. No real responder is paged. |
| [18: Internal knowledge assistant](example18_internal_knowledge_assistant/README.md) | An employee needs a company-policy or how-to answer. | Searches mock help-center content, explains an answer, and demonstrates filing a documentation-gap ticket when information is missing. |
| [19: IT access requests](example19_it_access_request_agent/README.md) | An employee requests access to a system or resource. | Checks a mock employee record, applies sample access policy, and files a mock request ticket. Does not grant real access. |
| [20: IT help desk](example20_it_help_desk_internal_support/README.md) | An employee needs help with a workplace IT problem. | Uses mock help articles, walks through one troubleshooting step at a time, and demonstrates creating or updating a support ticket. |
| [21: Language practice tutor](example21_language_practice_tutor/README.md) | A learner wants conversation practice suited to their level. | Runs a guided conversation, recaps the session, and simulates booking the next practice session. For measured pronunciation feedback, use the separate pronunciation-coach sample above. |
| [24: New-hire onboarding](example24_new_hire_onboarding_assistant/README.md) | A new employee wants guidance through their first day. | Explains role-specific onboarding, benefits, and contacts; simulates a manager 1:1 booking and a text with key contacts. |
| [27: Personal voice assistant](example27_personal_voice_assistant/README.md) | An employee wants a quick answer, a note, or help reaching the right team. | Searches mock help content, simulates emailing a note, and demonstrates creating a follow-up ticket. |
| [31: Survey and feedback](example31_survey_feedback_intake/README.md) | A customer agrees to a short feedback call. | Checks a mock customer record, asks four questions, and reads back the answers. Feedback remains unsubmitted because there is no feedback-write integration. |
| [34: User research interviewer](example34_user_research_interviewer/README.md) | A product team wants to learn about a user's needs and experience. | Adapts the interview to available time and simulates saving recap notes only with the participant's agreement. No real research record is stored. |

### Developer building blocks and integrations

These are focused implementation examples, not complete industry applications.

| Sample project | Use case | What it demonstrates |
| --- | --- | --- |
| [Basic Python voice agent](basic_voice_agent.py) | Start a first microphone conversation with a saved agent. | Creates and versions an agent or connects to an existing one, then streams speech. |
| [REST agent lifecycle](simple_rest_lifecycle.py) | Manage an agent without starting a voice call. | Creates a simple agent or retrieves an existing one through REST. |
| [C# voice agent](CSharp/README.md) | Add voice conversation to a .NET application. | Streams microphone/speaker audio, manages temporary or existing agents, and reads persisted conversations and recordings. |
| [Java voice agent](java/README.md) | Add live voice interaction to a Java application. | Demonstrates asynchronous audio, interruption, conversation readback, and temporary-agent cleanup. |
| [Voice Live to Voice Agent migration](voice_live_to_voice_agent/README.md) | Move an existing voice application to a reusable managed agent. | Compares the same Azure Speech / GPT-4.1 mini / TTS pipeline and local functions before and after migration. |
| [Google ADK integration](adk_voice_agent/README.md) | Use an existing Foundry Voice Agent in an ADK live-audio application. | Switches between Gemini Live and Foundry through configuration while handling audio conversion, transcripts, and interruptions. |
| [Add voice to an existing customer agent](existing_agent_voice_design/README.md) | Keep existing conversation logic while adding managed speech interaction. | An architecture guide using a Hosted Agent as the conversation engine. **Design guide only; not a runnable demo.** |
| [Regional and Data Zone voice agents](realtime_datazone_voice_agent.md) | Demonstrate a voice conversation with explicit region and inference-routing requirements. | Documents supported project/model combinations and a hands-free microphone client; routing prerequisites differ by project and model. |
| [GPT Live with Responses delegation](gpt_live/python/README.md) | Talk to an English teacher from the terminal. | Streams microphone audio through GPT Live and delegates responses to a model; reports the conversation ID after closing. |
| [GPT Live with managed prompt-agent delegation](gpt_live/python/README.md#managed-prompt-agent-delegation) | Let a reusable prompt agent handle the voice assistant's reasoning. | Creates a prompt agent, pins its version, and connects it to GPT Live for spoken conversation. |
| [GPT Live with prompt-agent tools](gpt_live/python/README.md#managed-prompt-agent-with-mcp-and-local-function-tools) | Ask the voice assistant to calculate a sum or report the current date/time. | Gives the delegated prompt agent an MCP calculator and a client-executed date/time function. |
| [SIP voice agent with GPT Live](sip_voice_agent/README.md) | Reach a voice agent through an inbound SIP phone connection. | Sets up and binds a SIP connection, configures access controls, inspects call records, and removes test routing. Requires telephony configuration. |
| [MCP tools](voice_agent_with_mcp.py) | Let a spoken request call a remote tool service. | Connects an agent to MCP and displays tool arguments and results during microphone conversation. |
| [Foundry IQ knowledge](voice_agent_with_foundry_iq.py) | Answer spoken questions using a configured knowledge source. | Creates an IQ-enabled agent and shows knowledge-tool activity during the call. |
| [Local function calls](voice_agent_with_local_function.py) | Let the agent ask the application to perform a calculation. | Executes `add_numbers` locally, returns the result to the agent, and speaks the answer. |
| [Toolbox integration](voice_agent_with_toolbox.py) | Reuse a configured collection of tools in a voice conversation. | Attaches a Toolbox to an agent and displays tool activity while the user talks. |
| [Prompt subagent](subagent/voice_subagent_prompt_basic/README.md) | Ask a general voice assistant for a poem. | Delegates poem writing to a specialized prompt subagent. |
| [Hosted GitHub Copilot subagent](subagent/voice_subagent_hosted_agent/README.md) | Ask for research, learning, or coding help by voice. | Delegates the task to an existing hosted GitHub Copilot agent. |
| [Long tool waits with spoken reminders](long_tool_wait/README.md) | Keep a caller informed while an operation takes time. | Speaks progress reminders during slow local tools with both realtime and cascaded pipelines. |
| [Spoken identifiers with digit recognition](digit_recognition/README.md) | Capture a spoken numeric identifier accurately before continuing. | Recognizes digits, reads the full sequence back digit by digit, and asks for confirmation. |

### Transcription, evaluation, and operations

| Sample project | Use case | What it produces |
| --- | --- | --- |
| [Realtime speech transcription](realtime_stt/README.md) | Turn microphone or WAV audio into text without an assistant replying. | Live transcription using MAI Transcribe 2 or Azure Speech, plus final usage and completeness information. |
| [Recording refinement and translation](audio_transcribe_and_translate/README.md) | Clean up or translate the transcript of a short recording. | Transcribes a WAV of up to 60 seconds and refines or translates it with a voice agent; includes guidance for adapting the instructions to summarization. |
| [Conversation simulation and evaluation](simulation_evaluation/README.md) | Check whether an agent can complete a scenario without manually playing every caller. | Generates adaptive simulated conversations from user goals and scores task completion and coherence. Text is the default; cloud voice needs a supported configuration. |
| [Create, converse, and evaluate](conversation_evaluation/README.md) | Measure successful and deliberately failed tasks using actual spoken exchanges. | Runs four three-turn audio sessions against one stored agent, grades transcripts, and exports WAV files and results. |
| [Airline refund evaluation tutorial](foundry_evaluation/README.md) | Evaluate how an airline assistant explains refund eligibility. | An illustrated portal walkthrough with a mock reservation lookup, fixed 24-hour rule, and custom rubric. No cancellation or refund; the optional Python runner has documented compatibility issues. |
| [Voice Agent Cost Lab](../tools/cost_calculator/README.md) | Estimate voice-agent list-price costs before running a demo. | A standalone browser calculator with model and pipeline comparisons, prompt-size sensitivity, and CSV export. No Azure credentials required; estimates are not a bill. |
| [Conversation artifact download](download_conversation_artifacts.py) | Review the text and audio of a stored call. | Downloads conversation JSON, per-turn WAV files, and a merged stereo recording. |
| [Conversation trace download](download_conversation_traces.py) | Investigate what happened during a particular call. | Downloads Application Insights trace rows correlated by conversation ID. |

### Realtime sample: Project region, model, and GPU routing

Examples 1 and 2 use 400 ms `azure_semantic_vad` silence. Examples 3–34 use Example 1's turn
detection (`profile: normal`, explicit barge-in thresholds, `end_of_utterance_detection: null`,
no server echo cancellation) with 600 ms silence.
Most use `gpt-realtime`; Finance Realtime uses `gpt-realtime-regional` and
Finance Cascade uses `gpt-4.1-mini`. Each card has a single version, its root
`agent.json`. Runtime configuration does not by itself establish improved
measured latency or VAD safety.

The separate regional samples below intentionally document their own model
and Project requirements; they are not additional Portal template versions.

| Foundry Project region | Model to select | GPU inference location |
| --- | --- | --- |
| East US 2 (`eastus2`) | `gpt-realtime-2.1-datazone` | Within the US data zone; not necessarily East US 2 specifically. |
| Japan East (`japaneast`) | `azure-realtime` | Japan East, with service-team-confirmed routing for the selected Project. |
| Central India (`centralindia`) | `gpt-realtime` | Standard (regional) processing in Central India, per the public model/region table; Voice Agent eligibility must be confirmed separately. |

**East US 2 Project: use the Data Zone model to keep inference on US GPUs.
Japan East Foundry Project: use Azure Realtime with confirmed Japan East GPU routing.**
The Japan East routing confirmation is Project-specific, not a guarantee for
every Japan-region Project or a change to the public Global Standard
classification. See the [full setup and commands](realtime_datazone_voice_agent.md).
For Central India, use the exact `gpt-realtime` model, not `gpt-realtime-2.1`
(the latter is listed as Global Standard there). The public table currently
does not list Agent support in Central India; confirm enablement before running
this voice-first Agent sample.

## Choose the right setup

The Voice Live migration, Finance, Elevator, language-learning, vehicle-local-tools, image-input, long-tool-wait, and documentation-generated voice web
samples use their own `requirements.txt` files. The voice web sample uses a standalone HTTP/WebSocket
backend and does not require the Projects SDK; follow its README for setup.
The common Python SDK samples require `azure-ai-projects>=2.7.0` from PyPI.

The GPT Live samples in `gpt_live/` share one `.env`. The Python terminal samples in
`gpt_live/python/` use their own `samples/gpt_live/python/.venv` with pinned packages and a
bundled preview `azure-ai-projects` 2.11.0 wheel from `dist/` for the GPT Live agent models
and Live WebSocket client; that preview changes APIs other samples use, so keep it out of the
shared `.venv`. The browser sample in `gpt_live/js/` uses Node.js 22+ and
the bundled preview `@azure/ai-projects` package from `dist/` instead. Follow their READMEs
for configuration and installation.

The SIP sample in `sip_voice_agent/` is standalone and uses its own
`requirements.txt` and local `.env`. Follow its README for SIP client/PBX setup;
it does not open a local microphone or require the Projects SDK or PortAudio.

## Common Python sample prerequisites

- Python 3.10 or later.
- An Azure AI Foundry Project endpoint:
  `https://<account>.services.ai.azure.com/api/projects/<project>`.
- Azure CLI sign-in (`az login`) or another `DefaultAzureCredential` identity.
- A microphone, speakers or headset, and PortAudio for the audio samples.
- Azure AI Projects SDK 2.7.0 or later, installed by the requirements below.

## Common Python sample setup

Run these commands from the parent `VoiceAgent` directory.

PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r samples\requirements.txt
if (-not (Test-Path samples\.env)) { Copy-Item samples\.env.example samples\.env }
```

Linux, macOS, or WSL2:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r samples/requirements.txt
[ -f samples/.env ] || cp samples/.env.example samples/.env
```

The single `pip install` command installs every common Python sample
dependency, including Projects SDK 2.7.0 or later with its `[voice]`
dependencies. No Azure SDK source checkout or Voice Live SDK is required.

For an existing preview or source installation, rerun the requirements install
command above to replace it with the released SDK.

Set the Project endpoint in `samples/.env`:

```dotenv
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
AZURE_VOICE_AGENTS_MODEL=gpt-realtime
```

## Run the agent samples

Run a sample without an Agent-name argument to create a new Agent. Pass an
existing Agent name to skip creation and use its stored model, audio,
instructions, and tools:

```text
python samples/<sample-name>.py
python samples/<sample-name>.py <agent-name>
```

On Linux, macOS, or WSL2, use `.venv/bin/python` if the virtual environment is
not activated. You can alternatively set `AZURE_VOICE_AGENTS_AGENT_NAME` in
`samples/.env`.

### Simple REST creation

The REST sample puts the Agent name in the URL and sends the description and
definition to the same version-creation endpoint used by the SDK:

```text
POST <project-endpoint>/agents/<agent-name>/versions?api-version=v1
Authorization: <Entra token>
Foundry-Features: VoiceAgents=V1Preview
Content-Type: application/json
```

Run:

```text
python samples/simple_rest_lifecycle.py
```

### Basic Agent: create, version, and microphone chat

The basic sample uses `VoiceAgentDefinition` and the audio/tool models from
`azure.ai.projects.models`. It creates an Agent version through
`AIProjectClient` with preview features enabled:

```python
from azure.ai.projects.aio import AIProjectClient

async with AIProjectClient(
    endpoint=endpoint,
    credential=credential,
    allow_preview=True,
) as client:
    version = await client.agents.create_version(
        agent_name=agent_name,
        definition=definition,
    )
```

To update the definition, call `client.agents.create_version` again with the
same Agent name. The returned version identifier is `version.version`.
Retrieve an existing Agent with `client.agents.get(agent_name=agent_name)`.
The same Projects client opens the Voice Agent realtime session:

```python
async with client.beta.voice_agents.realtime.connect(agent_name=agent_name) as connection:
    await connection.input_audio_buffer.append(audio=pcm_bytes)
    async for event in connection:
        # Handle transcripts, audio, and tool events.
        ...
```

The SDK owns authentication, the Agent WebSocket URL, and the
`Foundry-Features: VoiceAgents=V1Preview` header. No private URL overrides or
Voice Live SDK imports are needed. The Agent's stored definition controls the
session; the samples do not send a replacement `session.update`.

See the upstream [Voice Agent SDK samples](https://github.com/Azure/azure-sdk-for-python/tree/azure-ai-projects_2.7.0/sdk/ai/azure-ai-projects/samples/agents/voice)
for additional realtime usage.

Audio output uses a voice-name string and a separate `voice_type`, for example
`VoiceAgentAudioOutputConfig(voice="en-US-AvaNeural",
voice_type=VoiceType.AZURE_STANDARD)`.

Microphone samples use `RealtimeServerEventType` from
`azure.ai.projects.models` for event dispatch, including `SESSION_CREATED` and
`RESPONSE_OUTPUT_AUDIO_DELTA`. They follow the new Voice Agent protocol,
without legacy audio-event aliases.

```text
python samples/basic_voice_agent.py
```

### MCP with live microphone audio

The MCP tool references a Foundry Project connection that stores the target and
authentication configuration:

```json
{
  "type": "mcp",
  "server_label": "my-mcp-server",
  "project_connection_id": "<project-connection-id>",
  "require_approval": "never"
}
```

Do not put MCP credentials in the Agent definition. Create a Foundry Project
connection for the MCP server, then set:

```dotenv
AZURE_VOICE_AGENTS_MCP_CONNECTION_ID=<project-connection-id>
AZURE_VOICE_AGENTS_MCP_SERVER_LABEL=my-mcp-server
```

Run:

```text
python samples/voice_agent_with_mcp.py
```

Speak a request that the MCP tools can answer. Press Ctrl+C to finish. The
sample prints the persisted conversation ID.

### Foundry IQ with live microphone audio

A Foundry IQ knowledge base is represented as an MCP tool with its
knowledge-base URL and Project connection:

```json
{
  "type": "mcp",
  "server_label": "foundry-iq",
  "server_url": "https://<search-service>.search.windows.net/knowledgebases/<knowledge-base>/mcp?api-version=<version>",
  "project_connection_id": "<project-connection-id>",
  "require_approval": "never"
}
```

Set:

```dotenv
AZURE_VOICE_AGENTS_FOUNDRY_IQ_URL=https://<search-service>.search.windows.net/knowledgebases/<knowledge-base>/mcp?api-version=<version>
AZURE_VOICE_AGENTS_FOUNDRY_IQ_CONNECTION_ID=<project-connection-id>
```

Run:

```text
python samples/voice_agent_with_foundry_iq.py
```

Ask a question covered by the knowledge base. Use a headset to reduce echo;
talk over the Agent to test barge-in and press Ctrl+C to finish.

### Client-executed local function

A `function` tool is executed by the connected client. After the function-call
response's `response.done` event, the sample sends a typed
`RealtimeConversationItemFunctionCallOutput` and requests the model's follow-up
response. Waiting avoids a concurrent-response error.

```text
python samples/voice_agent_with_local_function.py
```

Say: **"Add 5 and 7. You must use the add_numbers function."** The sample
executes Python locally, prints `{"sum": 12.0}`, returns the result to the
session, and plays the spoken answer.

### Foundry Toolbox

A `toolbox` tool references a versioned Foundry Toolbox:

```json
{
  "type": "toolbox",
  "toolbox_name": "voice-agent-toolbox-azure-search",
  "toolbox_version": "1"
}
```

Toolbox calls are surfaced through MCP events, allowing clients to display the
tool name, arguments, and structured output. Configure the Toolbox name and
version in `samples/.env`, then run:

```text
python samples/voice_agent_with_toolbox.py
```

## Tracing and evaluation

When a conversation ends, use the URL printed in the terminal log to view the
trace in the Azure AI Foundry portal and run evaluations.

## Download conversation and audio

Microphone samples capture the top-level `conversation_id` from the
`session.created` event and print it when the session ends. Copy the printed
Agent name and conversation ID and run:

```text
python samples/download_conversation_artifacts.py <agent-name> <conversation-id>
```

The downloader waits for persistence to complete and writes:

```text
voice-agent-output/<conversation-id>/
|-- conversation.json
|-- merged.wav
`-- turns/
    |-- 001_user_<item-id>.wav
    |-- 002_agent_<item-id>.wav
    `-- ...
```

- `conversation.json` contains the conversation envelope, responses, ordered
  items, and audio metadata.
- `turns/` contains every persisted user and assistant audio segment.
- `merged.wav` is the final stereo recording: caller on the left channel and
  Agent on the right.

Set `AZURE_VOICE_AGENTS_OUTPUT_DIR` in `samples/.env` to change the output
directory. For bring-your-own storage, the JSON manifest records returned blob
URIs instead of downloading WAV data through the service.

Conversation and audio download requires the Agent to have been created with
`store=true`. All Agents created by these common samples enable it.

## Contributor resources

### Adding samples and portal templates

Use underscores between words in sample directory names, including subagent
examples.

Every example intended for the portal Templates page must follow
[Add an example to Portal Templates](./PORTAL_TEMPLATE_EXAMPLES.md). New
sample directories are not discovered automatically; they require the
documented portable `agent.json`, explicit allowlist entry, security rules,
tests, and source-sync update when applicable.

### Reusable coding-agent skills

The related workflows are under [`../skills/`](../skills/):

- [`debug-local-session`](../skills/debug-local-session/) resolves and analyzes
  recordings created by the portal.
- [`voice-agent-preview`](../skills/voice-agent-preview/) creates and tests
  Voice Agents with Projects SDK 2.7.0 and its preview voice APIs.
- `provision-foundry-iq` creates a Foundry IQ knowledge base from local files.
- `provision-foundry-toolbox` creates an Azure AI Search index and Foundry
  Toolbox.

### Validate without Azure access

With the common sample dependencies installed, run from `VoiceAgent`:

```text
python -m compileall -q samples skills
python -m unittest discover -s tests -v
```

The tests exercise the released SDK's WebSocket handshake, authentication and
preview headers, PCM serialization, event decoding, function-call ordering,
Agent versioning, and conversation/audio downloads. Only network and microphone
boundaries are mocked; the tests use the real Projects SDK. They do not create
Azure resources or open the microphone.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `401` or `403` | Sign in again and confirm Project access. |
| `404` during create or connect | Confirm preview enablement and region support. |
| Model not found | Set a voice-capable managed model or Foundry deployment. |
| MCP or Foundry IQ call fails | Verify the connection target, credential, and service reachability. |
| Microphone sample cannot start | Install PortAudio and `pyaudio`, then confirm microphone permission. |
| Trace query returns `403` | Grant the signed-in identity permission to query the Application Insights resource or its linked Log Analytics workspace. |

Never place access tokens, API keys, or connection secrets in source files.
Use Foundry Project connections or environment-based credentials.
