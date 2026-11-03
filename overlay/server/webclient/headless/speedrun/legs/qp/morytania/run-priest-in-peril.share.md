# Priest in Peril (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Priest in Peril** from King Roald to **stage 61**: the quest is complete (1 QP, the
Wolfbane dagger, prayer xp) and Drezel has given his warning, so the holy barrier in the mausoleum lets you through into
Morytania. Nature Spirit starts from the same Drezel, so the script ends standing next to him.

Steps: King Roald -> knock at the Paterdomus temple door ("Roald sent me") -> kill the Temple guardian under the mausoleum
-> Varrock Teleport back to the King -> kill a Monk of Zamorak in the temple for the golden key -> talk to Drezel through
his cell door -> swap the golden key for the iron key at monument 3 and fill the bucket at the well -> unlock the cell,
have Drezel bless the water, pour it on the vampire's coffin -> meet Drezel below (gates 1 and 2) -> hand over 50 rune
essence in two batches -> talk to him once more (stage 61).

The monument holding the iron key is fixed (monument 3, south-east) as long as nobody on the account has ever studied a
monument: studying generates a random layout.

## Live prerequisites
| Requirement | Why |
|---|---|
| A melee weapon and some combat (proven at attack/strength/defence/hitpoints 40 with a rune scimitar, no food needed) | The Temple guardian (combat 30, 45 hp) and one Monk of Zamorak (the golden key drop) must die. |
| Magic 25 | Two Varrock Teleports: back to the King (saves ~110 ticks over walking) and to the bank for the second essence batch. |
| Start next to King Roald in Varrock palace | The script starts the quest there. |

## Supplies (`--supply`)
- In the pack: rune essence x23 (**unnoted**; Drezel refuses notes), an empty bucket, law rune x2, air rune x6, fire rune x2.
- Worn: a weapon (the sim uses a rune scimitar).
- In the Varrock east bank: rune essence x27 (the pack only holds 23 at the start next to the bucket, runes and the key).

## Measured (offline lockstep sim, 400 ms ticks)
- Bank restock: 828, 797, 827, 812 ticks (three of them on chaos engines with random door states) -> median ~820 ticks
  (~5.5 min).
- Helper variant (`--helper`: a helper hands the 27 essence over at the top of the mausoleum trapdoor): 783, 700, 709,
  720 -> median ~715 ticks.

## Limits
- The King wanders in and out of his throne room; the script follows him through the door.
- A helper cannot come down to Drezel unless it has done the quest to stage 8 itself (the mausoleum gates check it).
