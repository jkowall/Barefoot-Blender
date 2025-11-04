# **Barefoot Blender: Advanced Gas Blending PWA Specification**

## **1.0 Overview**

### **1.1 Purpose**

This document outlines the functional and non-functional requirements for "Barefoot Blender," an advanced gas blending Progressive Web App (PWA). The application is intended for scuba divers, fill station operators, and technical divers. It will provide accurate calculations for partial pressure blending of Nitrox and Trimix, as well as common dive planning utilities, with a focus on a clean, mobile-first user interface and advanced utility features.

### **1.2 Target Platform**

The application will be a web-based PWA, built with a modern JavaScript framework (e.g., React, Angular, or Vue). It must be:

* **Fully Responsive:** Designed mobile-first to ensure perfect usability on iOS and Android devices, as well as tablets and desktops.  
* **Installable:** Deployed as a Progressive Web App (PWA), allowing users to "install" it to their home screen.  
* **Offline Capable:** Must be 100% functional without an internet connection after the initial load.

## **2.0 Core Use Cases**

* **Nitrox Top-Off:** A fill station operator (FSO) needs to top off a customer's tank containing 500 PSI of 32% Nitrox to 3000 PSI with a selected topping gas (e.g., Air).  
* **Simple Fresh Nitrox Blend:** An FSO needs to fill an empty tank to 3000 PSI with 32% Nitrox using banked Oxygen and a topping gas (e.g., Air).  
* **Fresh Trimix Blend:** A technical diver needs to blend a 10/70 Trimix in an empty tank to 3600 PSI using banked Helium, Oxygen, and a final topping gas.  
* **Trimix Top-Off:** An FSO needs to top off a tank containing 800 PSI of 18/45 to 3000 PSI with a target mix of 15/55, using banked Helium, Oxygen, and a final topping gas.  
* **Trimix Re-blend (Bleed Down):** A technical diver has a tank with 1500 PSI of 21/35 and wants to re-blend it to 10/50, finishing at 3000 PSI. The app must calculate how much gas to drain (the "bleed-down pressure") before adding Helium, Oxygen, and a final topping gas.  
* **Multi-Gas Nitrox Blend (Feature \#2):** An FSO has separate banks of 21% (Air) and 36% (Nitrox). They need to fill a customer's empty tank to 3000 PSI with 32% Nitrox and want to know how much of each banked gas to use.  
* **Blend Efficiency (Feature \#1):** An FSO calculates a top-off for a tank starting at 900 PSI. They want to quickly see the blend requirements if the tank had started at 800, 700, or 600 PSI to advise the customer if draining the tank slightly would be more efficient or cheaper.  
* **Utility Calculations (MOD/EAD/Best Mix/END/Density):**  
  * A diver has a tank of 36% Nitrox. They need to know its Maximum Operating Depth (MOD) for a PPO2 of 1.4.  
  * A diver plans a dive to 120 feet on 30% Nitrox. They need to know their Equivalent Air Depth (EAD).  
  * A diver plans a dive to 100 feet and wants to use a PPO2 of 1.4. The app must calculate the "Best Mix" (ideal O2%) for that depth.  
  * A diver plans a dive with 21/35 to 150ft. They need to know the Equivalent Narcotic Depth (END) of that gas.  
  * A diver plans a dive with 21/35 to 150ft. They need to know the density of that gas at depth in g/l.

## **3.0 Functional Requirements**

### **3.1 Module 1: Global Settings**

This module shall be accessible from a main navigation menu (e.g., "Settings" tab or icon). All settings must be saved locally on the user's device (localStorage) and persist between sessions.

* **3.1.1 Units:**  
  * User must be able to select pressure units: **PSI** (default) or **Bar**.  
  * User must be able to select depth units: **Feet** (default) or **Meters**.  
* **3.1.2 Banked Gases:**  
  * User must be able to define at least three "Custom Banked Gases" (e.g., "Bank 1", "Bank 2").  
  * For each custom gas, the user must be able to set:  
    * Name (string, e.g., "Bank 36")  
    * O2 % (number)  
    * He % (number)  
  * These custom gases will appear in the "Top-Off Gas" and "Multi-Gas Blender" selectors.  
* **3.1.3 Default PPO2:**  
  * User must be able to set a default "Max PPO2" (e.g., 1.4) for MOD and Best Mix calculations.  
  * User must be able to set a default "Contingency PPO2" (e.g., 1.6) for MOD calculations.  
* **3.1.4 Narcotic Gas Settings:**  
  * User must be able to toggle "Oxygen is Narcotic".  
  * This setting defaults to **OFF**.  
  * This toggle affects the END calculation (Module 3.5.4).

### **3.2 Module 2: Standard Blend Calculator (Top-Off & Fresh Fill)**

This will be the main screen of the application. It calculates blends using the partial pressure method.

* **3.2.1 Inputs:**  
  * **Start Tank:**  
    * Start O2 % (Input: 0-100)  
    * Start He % (Input: 0-100)  
    * Start Pressure (Input: number. 0 for fresh fill)  
  * **Target Blend:**  
    * Target O2 % (Input: 0-100)  
    * Target He % (Input: 0-100)  
    * Target Pressure (Input: number)  
  * **Top-Off Gases:**  
    * User must be able to select the gas used for the final top-off.  
    * The selector must include:  
      * Air (21/0)  
      * Oxygen (100/0)  
      * Helium (0/100)  
      * Any user-defined gases from Module 3.1.2.  
    * The default selection for this dropdown should be Air (21/0) or the user's "Bank Gas 1" if defined.  
* **3.2.2 Outputs (Blend Plan):**  
  * The application will display a clear, step-by-step blend plan.  
  * Example:  
    1. Add 1140 PSI Helium  
    2. Add 260 PSI Oxygen  
    3. Top-Off with 1600 PSI \[Topping Gas Name\]  
  * The output will dynamically change based on the gases needed (e.g., it will not show "Add 0 PSI Helium").  
* **3.2.3 Error Handling:**  
  * Must display clear, non-intrusive error messages for impossible blends (e.g., "Target O2 is not reachable with the selected top-off gas," "Start He% is already higher than Target He%").  
  * Must provide warnings (e.g., "Hypoxic mix," "High O2 \- Fire Risk").  
* **3.2.4 Bleed-Down Logic (for Re-blends):**  
  * If an impossible blend is detected *and* the start pressure is greater than 0 (e.g., Start He% \> Target He%), the app should automatically calculate a re-blend.  
  * The output will change to:  
    1. **BLEED tank down to \[XXX\] PSI**  
    2. Add \[YYY\] PSI Helium  
    3. Add \[ZZZ\] PSI Oxygen  
    4. Top-Off with \[AAA\] PSI \[Topping Gas Name\]  
  * This provides a complete solution without forcing the user to guess.

### **3.3 Module 3: Top-Off Chart (Feature \#1)**

This module will be displayed directly *below* the "Blend Plan" (3.2.2) output *only* when a top-off calculation is performed (i.e., Start Pressure \> 0\) and a bleed-down is *not* required.

* **3.3.1 Logic:**  
  * When a successful blend is calculated, the application will automatically re-run the *same calculation* (same start/target mixes, same top-off gas) using three hypothetical start pressures:  
    * Start Pressure \- 100 (or 10 bar, if 'Bar' is selected)  
    * Start Pressure \- 200 (or 20 bar)  
    * Start Pressure \- 300 (or 30 bar)  
* **3.3.2 Display:**  
  * The output will be a simple, clear table.  
  * Any hypothetical start pressure that is below 0 or results in an impossible blend will display "N/A" or "Drain".  
  * Example Table:  
    | Start Pressure | Add He | Add O2 | Top-Off Gas |  
    | :--- | :--- | :--- | :--- |  
    | 900 PSI (Actual) | 100 PSI | 250 PSI | 1750 PSI |  
    | 800 PSI | 140 PSI | 270 PSI | 1790 PSI |  
    | 700 PSI | 180 PSI | 290 PSI | 1830 PSI |  
    | 600 PSI | 220 PSI | 310 PSI | 1870 PSI |

### **3.4 Module 4: Multi-Gas Blender (Feature \#2)**

This will be a separate tab or screen in the application, labeled "Multi-Gas Blend" or "2-Gas Mix". This module is primarily for creating a target Nitrox mix from two different source gases when filling a tank.

* **3.4.1 Inputs:**  
  * **Gas 1 (Bank):**  
    * Gas 1 O2 % (Selector: Air, user-defined gases, or custom input)  
  * **Gas 2 (Bank):**  
    * Gas 2 O2 % (Selector: Air, user-defined gases, or custom input)  
  * **Target Blend:**  
    * Target O2 % (Input: number)  
    * Target Pressure (Input: number, e.g., 3000\)  
* **3.4.2 Logic:**  
  * This module assumes filling a tank from 0 PSI.  
  * It solves the system of linear equations:  
    1. P\_gas1 \+ P\_gas2 \= Target\_Pressure  
    2. (P\_gas1 \* O2\_gas1) \+ (P\_gas2 \* O2\_gas2) \= Target\_Pressure \* Target\_O2  
* **3.4.3 Outputs (Fill Plan):**  
  * "1. Add \[P\_gas1\] PSI of \[Gas 1 Name\]"  
  * "2. Add \[P\_gas2\] PSI of \[Gas 2 Name\]"  
* **3.4.4 Error Handling:**  
  * Must display an error if the Target O2 % is not mathematically between the Gas 1 O2 % and Gas 2 O2 %.

### **3.5 Module 5: Utility Calculators**

This will be a separate tab or screen in the application, labeled "Utilities" or "Tools".

* **3.5.1 Maximum Operating Depth (MOD):**  
  * **Inputs:** O2 %, Target PPO2 (defaults to 3.1.3)  
  * **Output:** MOD in feet or meters.  
  * Will also show MOD for contingency PPO2 (e.g., 1.6).  
* **3.5.2 Equivalent Air Depth (EAD):**  
  * **Inputs:** O2 %, Depth  
  * **Output:** EAD in feet or meters.  
* **3.5.3 Best Mix:**  
  * **Inputs:** Target Depth, Target PPO2 (defaults to 3.1.3)  
  * **Output:** Ideal O2 %  
* **3.5.4 Equivalent Narcotic Depth (END):**  
  * **Inputs:** O2 %, He %, Depth  
  * **Logic:** Calculates END based on the Nitrogen fraction. If Oxygen is Narcotic (3.1.4) is ON, O2 is included with N2 as narcotic.  
  * **Output:** END in feet or meters.  
* **3.5.5 Gas Density:**  
  * **Inputs:** O2 %, He %, Depth  
  * **Logic:** Calculates the density of the gas mixture at the specified depth (in ATA).  
  * **Output:** Density in g/l (grams per liter).

## **4.0 Non-Functional Requirements**

* **4.1 Usability (UI/UX):**  
  * **Clarity:** The UI must be exceptionally clean, with high contrast and large fonts.  
  * **Input:** All input fields and buttons must be large and easily tappable ("fat-finger friendly") for use in a shop environment.  
  * **Flow:** The layout should follow a logical top-to-bottom flow: Start \-\> Target \-\> Gases \-\> Plan.  
  * **State Persistence:** The app must remember all inputs from the last session to allow for quick re-calculation or minor adjustments.  
* **4.2 Performance:**  
  * All calculations must be performed client-side.  
  * Results must be instantaneous (sub-100ms calculation time).  
* **4.3 Offline Capability:**  
  * The app must use a Service Worker to cache all necessary assets.  
  * Users who have visited the app once must be able to open and use it fully (including all calculations) without an internet connection.  
* **4.4 Calculation Fidelity:**  
  * Calculations must be based on the Ideal Gas Law (Partial Pressure Blending).  
  * (Future Enhancement): A setting could be added to toggle "Ideal Gas" vs. "Van der Waals (Real Gas)" calculations for higher accuracy, though this adds significant complexity. For V1, Ideal Gas is sufficient.

## **5.0 High-Level UI/UX Wireframe (Conceptual)**

### **5.1 Main View (Tabbed Navigation)**

A simple header with three main tabs:

|

$$ \*\*Standard Blend\*\* $$  
|

$$ \*\*Multi-Gas Blend\*\* $$  
|

$$ \*\*Utilities\*\* $$  
|

$$ \*\*Settings (Icon)\*\* $$  
|

### **5.2 "Standard Blend" Tab**

\[ CARD: START TANK \]  
  O2 % \[ 21.0 \]   He % \[ 0.0 \]  
  Start Pressure \[ 500 \] \[PSI\]

\[ CARD: TARGET BLEND \]  
  O2 % \[ 32.0 \]   He % \[ 0.0 \]  
  Target Pressure \[ 3000 \] \[PSI\]

\[ CARD: TOP-OFF GAS \]  
  \[ Dropdown: Air (21/0) ▼ \]  
  (If blending Trimix, checkboxes for "Use Banked O2"  
   and "Use Banked He" would appear here)

\[ BUTTON: CALCULATE \]

\[ CARD: BLEND PLAN \]  
  (Hidden until CALCULATE is pressed)  
  1\. Add 285 PSI Oxygen  
  2\. Top-Off with 2215 PSI Air

\[ CARD: TOP-OFF CHART \]  
  (Hidden until CALCULATE is pressed & Start P \> 0\)  
  | Start P | Add O2 | Top-Off Gas |  
  | :--- | :--- | :--- |  
  | 500 PSI | 285 PSI | 2215 PSI |  
  | 400 PSI | 310 PSI | 2290 PSI |  
Next: 300 PSI, 335 PSI, 2365 PSI. 200 PSI, 360 PSI, 2440 PSI

### **5.3 "Multi-Gas Blend" Tab**

\[ CARD: SOURCE GASES \]  
  Gas 1: \[ Dropdown: Air (21/0) ▼ \]  
  Gas 2: \[ Dropdown: Bank 36 (36/0) ▼ \]

\[ CARD: TARGET BLEND \]  
  Target O2 % \[ 32.0 \]  
  Target Pressure \[ 3000 \] \[PSI\]

\[ BUTTON: CALCULATE \]

\[ CARD: FILL PLAN \]  
  (Hidden until CALCULATE is pressed)  
  1\. Add 800 PSI of Air (21/0)  
  2\. Add 2200 PSI of Bank 36 (36/0)

### **5.4 "Utilities" Tab**

\[ CARD: MOD \]  
  Gas O2 % \[ 32.0 \]  
  Max PPO2 \[ 1.4 \]  \-\> MOD: 130 ft  
  Contingency PPO2 \[ 1.6 \] \-\> MOD: 152 ft

\[ CARD: EAD \]  
  Gas O2 % \[ 32.0 \]  
  Depth \[ 100 \] ft  
  \-\> EAD: 82 ft

\[ CARD: Best Mix \]  
  Target Depth \[ 100 \] ft  
  Target PPO2 \[ 1.4 \]  
  \-\> Best Mix: 36.4 % O2

\[ CARD: END \]  
  Gas O2 % \[ 21.0 \] He % \[ 35.0 \]  
  Depth \[ 150 \] ft  
  (O2 is narcotic: OFF)  
  \-\> END: 119 ft

\[ CARD: Gas Density \]  
  Gas O2 % \[ 21.0 \] He % \[ 35.0 \]  
  Depth \[ 150 \] ft  
  \-\> Density: 4.8 g/l
