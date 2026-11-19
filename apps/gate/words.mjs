// Short, common, easy-to-say English words for passwords read aloud over the
// phone. test/unit.test.mjs checks the list is unique and at least 1,024 long,
// so four words carry at least 40 bits.

export const WORDS = `
able acid acorn actor add adobe adult aft again age agent aged aid aim air airy aisle alarm album alert
alley alpha amber amble ample angle ankle apple april apron arch arena arm armor army aroma arrow art ash
aspen atlas atom attic audio aunt auto avid awake award axe axis baby back bacon badge bag bagel bake baker
bald ball bamboo banana band bank bar barn baron base basil basin basket bat batch bath baton bay beach bead
beak beam bean bear beard beast beat bed bee beef beet bell belt bench berry best bib bike bill bind bird
birch bison bit black blade blank blast blaze blend bless blink bliss block bloom blue bluff blunt blur
board boat body boil bold bolt bond bone bonus book boom boost boot booth born boss both bough bowl box
brain brake branch brand brass brave bread break brick bride brief bring brisk broad brook broom brush
bubble buck bucket bud buddy buggy build bulb bull bump bunch bunny burst bush busy butter button buzz
cabin cable cactus cage cake calf calm camel camp canal candy cane canoe canyon cap cape car card cargo
carol carpet carrot cart case cash cast cat catch cause cave cedar cell cello chain chair chalk champ
chant charm chart chase cheek cheer cheese chef cherry chess chest chick chief child chili chime chin chip
chirp choir chord chore chunk cider cinema circle city civic claim clam clap clay clean clear clerk click
cliff climb clip clock close cloth cloud clove clown club clue coach coal coast coat cobalt cocoa coconut
code coffee coil coin cold collar colt comb comet comic comma cone cook cool copper copy coral cord core
cork corn couch cough count court cove cover cow coyote crab craft crane crash crate crawl crayon cream
creek crest crew crib crisp crop cross crow crown crumb crust cube cup curb curl curve cycle daisy dance
dandy dare dark dash data date dawn day deal deck deep deer delta den depot depth desk dial diary dice
diet dig dime diner dingo dip dish disk ditch dive dock doe dog doll dolphin dome donkey door dot double
dough dove down dozen draft dragon drain drama draw dream dress drift drill drink drip drive drum duck
dune dusk dust duty eager eagle ear early earth easel east easy echo edge eel egg eight elbow elder elk
elm ember emu end energy enjoy entry epic equal error essay even event exam exit extra eye fable face fact
fair fairy faith fall fame fancy farm fast fawn feast feather fence fern ferry fever fiber field fig film
final finch find fine finger fir fire firm first fish five fix flag flake flame flash flask flat fleet
flick flint float flock flood floor flour flow flower fluid flute fly foam focus fog foil folk font food
foot force forest fork form fort forty fossil fox frame free fresh friend frog front frost fruit fudge
fuel full fun funny fur gala game gap garden garlic gas gate gauge gear gecko gem genie gentle giant gift
ginger girl glad glass glee glide globe glove glow glue goal goat gold golf good goose gourd grace grade
grain grand grant grape graph grass gravy gray great green grid grill grin grip grove grow guard guava
guess guest guide gulf gull gum guru habit hair half hall halo ham hammer hand happy harbor hard harp
hat hatch hawk hay hazel head heart heat hedge heel hello helmet help hen herb hero heron hill hint hip
hippo hobby hockey hold hole holly home honey hood hoof hook hope horn horse host hot hotel hour house
hug human humor hunt hush hut ice icon idea igloo image inch index ink inlet input iris iron island
item ivory ivy jacket jade jam jar jazz jeans jelly jet jewel job jog join joke jolly journal joy judge
juice july jump june jungle jury just kale kayak keen keep kelp kettle key kick kid kind king kit kite
kitten kiwi knee knife knob knot koala lab label lace ladder lady lake lamb lamp land lane lap large
laser latch late lava lawn layer lead leaf lean learn leash leather left lemon lens lentil level lever
light lilac lily lime limit line linen lion lip list little live lizard llama load loaf lobby local
lock lodge loft logic long loop lotus loud love loyal lucky lunar lunch lung lyric magic magnet maid
mail main major maker mango manor map maple marble march mare market mask match math maze meadow meal
media medal melon memo menu merit mesa metal meter mild mile milk mill mimic mind mine mint minute mirror
mist mitten mix moat model modem mole moment money monk month moon moose moss motel moth motor mound
mount mouse mouth move movie mud muffin mug mule music nacho nail name nap navy near neat neck need
needle nest net new news next nice night nine noble noise noodle noon north nose note novel nudge
number nurse nut oak oasis oat ocean octave odd offer office often oil olive omega onion open opera
orange orbit orca order organ otter ounce oven owl owner oxen oyster pace pack paddle page pail paint
pair palm pan panda panel pants paper parade park parrot party pasta paste patch path patio pause
paw peace peach peak pear pearl pecan pedal pen pencil penny pepper perch piano pick pickle picnic pie
piece pig pigeon pike pile pillow pilot pine pink pint pipe pitch pizza place plain plan plane plank
plant plate play plaza plot plow plum plus pocket poem poet point polar pole polka pond pony pool poppy
porch port pose post pot potato pouch power prairie press pretty price pride prime print prism prize
proof proud prune pulse puma pump punch pupil puppy purple purse push puzzle quail quart queen quest
quick quiet quill quilt quiz rabbit race rack radar radio raft rain rake ramp ranch range rapid rate
raven ray razor reach ready realm rebel recipe red reed reef relax relay rent reply rest rhyme rib
ribbon rice rich ride ridge right rim ring rinse ripe ripple rise river road roast robe robin
robot rock rocket rodeo roll roof room root rope rose rotor round route rover row royal ruby rug ruler
rumble run rush rust saddle safe saga sage sail salad salmon salt sand sandal satin sauce save scale
scarf scene scoop scout scrap screen script scroll sea seal season seat second seed seven shade shadow
shake shape share shark sharp shed sheep shelf shell shield shift shine ship shirt shoe shore short
shovel show shrub sign silk silver simple sing siren sister six skate sketch ski skill skirt sky slate
sled sleep sleeve slice slide slope slot smart smile smoke snack snail snake snow soap soccer sock sofa
soft soil solar sole solid song sonic soup south space spade spark spice spider spike spin spirit splash
spoon sport spot spray spring sprout spruce squad square squid stable stack staff stage stair stamp stand
star start state steam steel stem step stew stick still sting stone stool storm story stove straw
stream street stripe strong study style sugar suit summer sun sunny super surf swamp swan sweet swift
swim swing switch sword table taco tail tale talent tank tape target task taxi tea teach team teeth
tempo ten tennis tent term test text thank theme thick thing third thorn three thumb ticket tide tiger
tile timber time tin tiny tip toast today toe token tomato tone tool tooth top topic torch total
touch towel tower town toy track trade trail train tray treat tree trend trial tribe trick trip trophy
truck true trunk trust truth tuba tube tulip tuna tune turkey turn turtle tusk twig twin twist type
uncle under union unit upper urban usual valley value van vapor vase vault velvet venue verb verse
vest video view villa vine violet violin visit vista vivid vocal voice volume vote voyage wafer wage
wagon waist wait walk wall walnut wand warm wash wasp watch water wave wax way wealth weave web wedge
week weird well west wet whale wheat wheel whip whisk white whole wick wide width wild willow win wind
window wing wink winter wire wise wish witty wizard wolf wonder wood wool word work world worm wrap
wren wrist yacht yak yard yarn year yeast yellow yes yoga yogurt young yummy zebra zero zest zigzag
zinc zip zone zoo
`.trim().split(/\s+/);
