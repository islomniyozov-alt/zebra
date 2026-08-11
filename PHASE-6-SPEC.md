# TMS FEATURE PROMPT — AMAZON EMAIL-TO-LOAD AUTOMATION & MULTI-STOP INTELLIGENCE

Add a powerful **Email-to-TMS AI Load Automation system** to the trucking TMS.

The goal is to eliminate the current manual process we use with DataTruck.

### CURRENT PROCESS

When we book an Amazon load, Amazon sends us a booking confirmation email.

Our current process is:

1. Receive Amazon booking confirmation email.
2. Download an Excel "Load Information" sheet from the email.
3. Upload the Excel file manually into DataTruck TMS.
4. DataTruck reads the pickup and delivery information.
5. Dispatcher reviews and creates the load.

This is still unnecessary manual work.

The new TMS should automate this entire process.

---

# 1. AMAZON EMAIL INTEGRATION

Allow the TMS to connect to a company email account or dedicated load-inbox email.

The system should monitor incoming emails and identify Amazon load booking/confirmation emails automatically.

When an Amazon booking email arrives:

**Email → AI → Extract Information → Create Draft Load → Dispatcher Review → Confirm**

The dispatcher should NOT have to download the Excel file manually.

The system should be able to read information from:

* Email body
* Excel attachments
* PDF attachments
* BOL documents
* Rate confirmations
* Images/scanned documents
* Other common freight documents

If the Amazon email contains an Excel Load Information sheet, automatically open and process the attachment in the background.

---

# 2. AUTOMATIC LOAD CREATION

When a new Amazon booking is detected, automatically create a **Draft Load** in the TMS.

Do NOT immediately finalize the load.

The system should show:

**NEW AMAZON LOAD — REVIEW REQUIRED**

Extract all available information and populate the load automatically.

The dispatcher should only need to review the information and click:

**CONFIRM LOAD**

---

# 3. MULTI-LEG / MULTI-STOP LOAD ENGINE

This is extremely important.

Do NOT design the TMS around only one pickup and one delivery.

A single load can contain:

* Multiple pickup stops
* Multiple delivery stops
* Multiple legs
* Multiple appointment times
* Multiple reference numbers
* Multiple PO numbers
* Different facilities
* Different BOLs
* Different instructions

The database architecture must support:

**Load → Stops → Legs**

instead of simply:

**Load → Pickup → Delivery**

Example:

LOAD #AMZ-48291

STOP 1
Pickup
Amazon Facility
Chicago, IL
08:00–10:00

↓

STOP 2
Pickup
Amazon Facility
Gary, IN
11:30–12:30

↓

STOP 3
Delivery
Amazon Facility
Columbus, OH
17:00–19:00

↓

STOP 4
Delivery
Amazon Facility
Pittsburgh, PA
22:00–00:00

The system must preserve the exact sequence of stops.

---

# 4. STOP INFORMATION

Every stop must have its own independent data.

Each stop should support:

* Stop number
* Pickup / Delivery type
* Facility name
* Building number
* Street
* City
* State
* ZIP
* GPS coordinates
* Appointment date
* Appointment start time
* Appointment end time
* Contact
* Phone
* PO number
* BOL number
* Reference number
* Load/leg number
* Commodity
* Pieces
* Pallets
* Weight
* Special instructions
* Check-in instructions
* Dock information
* Gate information
* Lumper information
* Notes

---

# 5. AI MULTI-STOP EXTRACTION

The AI must intelligently understand the structure of Amazon booking information.

If the document contains 4 stops, create 4 stops.

If it contains 2 legs, create 2 legs.

If one leg contains multiple stops, preserve those relationships.

Do NOT combine multiple stops into one address field.

Do NOT lose appointment times.

Do NOT overwrite one stop with another.

Do NOT assume that the first address is always the pickup and the last address is always the delivery.

Use the information contained in the Amazon booking confirmation to determine the correct sequence and stop type.

---

# 6. AI VALIDATION

Before presenting the load to the dispatcher, automatically validate the information.

Check for:

* Missing pickup
* Missing delivery
* Missing appointment time
* Duplicate stops
* Duplicate PO numbers
* Duplicate BOL numbers
* Duplicate load
* Incorrect stop sequence
* Conflicting appointment times
* Invalid address
* Invalid city/state/ZIP
* Missing leg
* Conflicting reference numbers
* Impossible or suspicious route sequence
* Other inconsistencies

If something looks wrong, do not silently guess.

Flag it for dispatcher review.

Example:

⚠️ **Appointment Conflict**

Stop 2 appointment: 10:00 AM
Stop 3 appointment: 10:15 AM
Estimated travel time: 1 hour 20 minutes

**REVIEW REQUIRED**

---

# 7. AI CONFIDENCE SCORE

Every extracted field should have an AI confidence score.

Example:

Pickup Address — 99%
Delivery Address — 99%
Appointment — 98%
Weight — 96%
PO Number — 100%

If confidence is high, show it as verified.

If confidence is low, highlight the field.

Example:

🟢 High confidence
🟡 Review recommended
🔴 Critical / missing

The dispatcher should immediately see which information actually requires attention.

---

# 8. VISUAL ROUTE / STOP TIMELINE

Create a clean visual representation of the load.

Example:

**AMAZON LOAD #48291**

Chicago, IL
↓
Gary, IN
↓
Columbus, OH
↓
Pittsburgh, PA

Each stop should show:

**Stop 1 — PICKUP**

Amazon FC
Chicago, IL

08/07/2026
08:00–10:00

Then:

**Stop 2 — PICKUP**

Amazon FC
Gary, IN

08/07/2026
11:30–12:30

This should make complicated multi-stop loads easy for dispatchers to understand.

---

# 9. EDITABLE STOP SEQUENCE

Allow the dispatcher to:

* Edit any stop
* Add a stop
* Delete a stop
* Change pickup/delivery type
* Change appointment time
* Change address
* Reorder stops using drag-and-drop

If the dispatcher changes something, clearly indicate that it was manually modified.

---

# 10. AMAZON LOAD INBOX

Create a dedicated **Incoming Loads** section inside the TMS.

Example:

INCOMING LOADS

🟢 Amazon #48291
4 Stops — Ready
99% Confidence

🟢 Amazon #48292
2 Stops — Ready
98% Confidence

🟡 Amazon #48293
5 Stops — Review Required
81% Confidence

🔴 Amazon #48294
Conflict Detected

The dispatcher should immediately know which loads are ready and which require attention.

---

# 11. DUPLICATE PROTECTION

Before creating a load, compare the incoming Amazon booking against existing loads.

Check:

* Amazon load number
* BOL number
* PO number
* Reference number
* Booking number
* Pickup
* Delivery
* Date

If the system believes the load already exists, show:

**POSSIBLE DUPLICATE LOAD**

Do not create another load until the dispatcher confirms.

---

# 12. EMAIL ATTACHMENT MANAGEMENT

Keep the original email and attachments connected to the load.

Inside the load, provide:

**Source Documents**

* Original Amazon Email
* Amazon Excel Load Information
* BOL
* Rate Confirmation
* Other Attachments

The dispatcher should be able to open the original document directly from the load.

Store the source document reference so the dispatcher can always verify where the extracted information came from.

---

# 13. EMAIL THREAD MATCHING

If Amazon sends multiple emails related to the same booking, automatically connect them to the existing load instead of creating duplicates.

For example:

Initial Booking Email
↓
Updated Booking Email
↓
Schedule Change
↓
Updated Load Information
↓
Final Confirmation

The TMS should recognize that these emails belong to the same load and update the existing draft/load when appropriate.

Always maintain a history of changes.

---

# 14. AUTOMATIC UPDATE DETECTION

If Amazon sends an updated confirmation:

Do NOT simply create another load.

Compare the new information against the existing load.

Example:

Previous:

Delivery appointment
08/08 — 14:00

Updated:

Delivery appointment
08/08 — 16:00

Show:

**LOAD UPDATED**

Delivery appointment changed:

14:00 → 16:00

Require dispatcher confirmation before applying critical changes.

---

# 15. EMAIL-TO-TMS FALLBACK

The system must also support manual forwarding.

If automatic email monitoring is unavailable, dispatch can simply forward the Amazon email to the TMS load inbox.

Example:

**[loads@company-tms.com](mailto:loads@company-tms.com)**

The system should process the email exactly the same way.

---

# 16. DOCUMENT UPLOAD MUST STILL WORK

Email automation should NOT replace manual upload.

The TMS must support both:

### Automatic

Amazon Email
→ AI
→ Draft Load

### Manual

Upload Excel/PDF/BOL
→ AI
→ Draft Load

### Manual fallback

Create Load
→ Dispatcher enters information manually

All three methods should create the same standardized Load/Stop data structure.

---

# 17. LEARNING SYSTEM

When dispatchers correct extracted information, the AI should learn from those corrections.

For example:

AI reads:

Amazon Fulfillment Center

Dispatcher changes it to:

Amazon SAT4

The system should remember the relationship between the facility and its verified address.

Over time, the TMS should build a company-specific database of:

* Customers
* Amazon facilities
* Warehouses
* Addresses
* Appointment patterns
* Dock information
* Gate instructions
* Contacts
* Internal dispatcher notes
* Common reference formats

The more loads the company processes, the smarter the system should become.

---

# 18. DISPATCHER EXPERIENCE

The final workflow should be extremely simple.

### OLD WAY

Amazon Email
→ Download Excel
→ Open Excel
→ Save file
→ Open DataTruck
→ Upload Excel
→ Wait
→ Review
→ Fix multiple stops
→ Create Load

### NEW TMS

Amazon Email
↓
**AI automatically detects booking**
↓
**AI extracts load + all stops**
↓
**AI validates information**
↓
**Draft Load appears in Incoming Loads**
↓
**Dispatcher reviews**
↓

### CONFIRM LOAD

The target should be to reduce the dispatcher workflow to **seconds instead of several minutes**.

---

# 19. ARCHITECTURE REQUIREMENT

Build the system so that email ingestion, document extraction, AI processing, validation, and load creation are separate services/modules.

Use a standardized internal structure:

**Email → Document Parser → AI Extraction → Validation → Load/Stop Engine → Draft Load → Dispatcher Approval → Final Load**

The AI should NEVER directly overwrite production load data without an approval mechanism for important changes.

Maintain an audit trail showing:

* What AI extracted
* What confidence it had
* What dispatcher changed
* When it was changed
* Who changed it
* What the original value was
* What the final value became

---

# 20. MAIN OBJECTIVE

The purpose of this feature is to completely eliminate the unnecessary Excel-download/upload workflow currently required with DataTruck.

The new TMS should feel like an intelligent dispatch assistant.

**Amazon sends the booking.**

**The TMS receives it.**

**AI reads it.**

**AI builds the complete load.**

**AI separates every leg and stop correctly.**

**AI validates the information.**

**Dispatcher reviews it.**

**Dispatcher clicks CONFIRM.**

The system should make complex Amazon multi-leg loads as easy to manage as a simple one-pickup/one-delivery load.
