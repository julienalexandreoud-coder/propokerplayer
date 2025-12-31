# 🎯 Poker Assistant Pro: Mapping & Calibration Guide

This guide ensures your Vision AI is perfectly calibrated for 100% accuracy. Follow these steps sequentially.

---

## 1. The Core: Turn Detection (ROI)
The extension needs to know exactly when it is your turn to act.

### **Step A: Set Turn ROI**
1. Click **Set Turn ROI**.
2. **Drag a box** over an area that **only changes when it is your turn**.
   - ✅ **GOOD**: Your time-bank bar, your glowing cards, or the Action Buttons (Fold/Call).
   - ❌ **BAD**: The community cards or the pot total (these change when it's NOT your turn too).

### **Step B: Sync Turn**
1. Wait until it is **NOT your turn** (the bar/cards are gone).
2. Click **Sync Turn**.
3. The extension now has a "Reference Hash" of what the empty table looks like. When a match occurs, it knows you are active.

### **Step C: Sensitivity**
- If the AI activates too late (or never): **Increase** Sensitivity.
- If the AI activates when it's NOT your turn: **Decrease** Sensitivity.

---

## 2. Multi-Region Analysis (Table Context)
This tells the AI who has folded and where the Dealer Button is.

### **Step A: Map Button Ref**
1. Click **Map Button Ref**.
2. **Drag a small box** over the actual "Dealer D" icon on the table.
3. This creates the "Master Reference" that the AI will look for at every seat.

### **Step B: Player Status (P1-P5)**
1. Click **P1 Status**.
2. **Drag a box** over the area where Player 1's cards or "Folded" gray-out appears.
3. Repeat for P2-P5 status.

### **Step C: Player Button Spots (P1b-P5b)**
1. Click **P1 Button**.
2. **Drag a box** over the area where the Dealer Button lands when Player 1 is the dealer.
3. Repeat for P2-P5 button spots.

---

## 3. Action Clickers (Macro)
Move the **FOLD**, **CALL**, **RAISE**, and **SIT** markers directly over the center of your table's action buttons. The Hub will save these positions automatically.

---

## 4. Saving Your Setup
Once everything is calibrated:
1. Go to the **STRATEGY** tab.
2. Enter a site name in the Layout box (e.g., "Winamax 6-max").
3. Click **SAVE**.
4. You can now restore this entire setup with one click next time you play on that site.

---

## 💡 Pro Tips for 100% Accuracy
- **Don't Move the Window**: If you resize or move the poker window, you must recalibrate.
- **Clean Screenshots**: The extension automatically hides the dashed boxes during analysis, so don't worry about them interfering with the "sync."
- **Check the Metadata Monitor**: Look at the bottom of the hub. It should correctly report "Active Players" and "Dealer Button Position" in real-time.
