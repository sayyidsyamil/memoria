"""AMI series specification: tracked items and the decisions that set or change them.

Provenance. Every event below comes from a DECISIONS sentence in the AMI human-written abstractive summary
(abstractive/<meeting>.abssumm.xml). `s` is the sentence number, so the sentence can be re-read. The evidence
utterance is not chosen here: it is found through the human-made summary-to-dialogue-act links (extractive/*.summlink.xml),
and `kw` only picks the best-matching utterance among them. The slot list and the allowed values were written by the AI
assistant from those sentences (so they are fixed in advance, as in the synthetic chains: the registry is given).
Dev teams are for building and debugging the pipeline; test teams are the official AMI unseen-evaluation set (SC),
and nothing is tuned on them.

Format:  objects = (id, label, phrase used in questions, allowed values or "number")
         events  = (meeting letter, object id, value, summary sentence number, kw regex)
         skip_changes = slots whose 'how many changes' question would be ambiguous (changes inside one meeting)
"""

SPECS = {
    # ---------------------------------------------------------------- dev
    "ES2003": dict(split="dev", objects=[
        ("prod_cost", "Production cost per remote (euro)", "the production cost per remote, in euros", "number"),
        ("price", "Selling price (euro)", "the selling price of the remote, in euros", "number"),
        ("devices", "Devices the remote controls", "which devices the remote controls", ("televisions only", "multiple devices")),
        ("teletext", "Teletext feature", "whether the remote has teletext", ("included", "excluded")),
        ("lcd", "LCD screen", "whether the remote has an LCD screen", ("included", "excluded")),
        ("battery", "Battery type", "the battery type of the remote", ("lithium", "kinetic", "rechargeable", "conventional")),
        ("case_curve", "Case curvature", "the curvature of the remote's case", ("single curved", "double curved")),
        ("case_material", "Case material", "the material of the remote's case", ("rubber", "plastic")),
        ("colour", "Remote colour", "the colour of the remote", ("yellow", "special colour")),
    ], events=[
        ("a", "prod_cost", 12.5, 6, r"twelve|12[. ]?5"),
        ("a", "price", 25, 7, r"twenty[- ]?five|\b25\b"),
        ("b", "teletext", "excluded", 10, r"teletext"),
        ("b", "devices", "televisions only", 11, r"\btv\b|televis"),
        ("b", "lcd", "included", 15, r"l[_ ]?c[_ ]?d"),
        ("c", "battery", "lithium", 8, r"lithium"),
        ("c", "case_curve", "double curved", 9, r"double|curve|round"),
        ("c", "case_material", "rubber", 10, r"rubber"),
        ("c", "colour", "yellow", 11, r"yellow"),
        ("d", "lcd", "included", 9, r"l[_ ]?c[_ ]?d"),
        ("d", "case_curve", "single curved", 10, r"single"),
        ("d", "colour", "special colour", 11, r"special|colou?r"),
        ("d", "case_material", "plastic", 12, r"plastic"),
    ], skip_changes=()),
    "TS3004": dict(split="dev", objects=[
        ("remote_type", "Kind of remote", "what kind of remote it is", ("universal", "single device")),
        ("speech", "Speech recognition", "whether the remote has speech recognition", ("included", "excluded")),
        ("lcd", "LCD screen", "whether the remote has an LCD screen", ("included", "excluded")),
        ("teletext", "Teletext feature", "whether the remote has teletext", ("included", "excluded")),
        ("battery", "Battery type", "the battery type of the remote", ("rechargeable", "conventional", "kinetic")),
        ("case_material", "Case material", "the material of the remote's case", ("plastic", "rubber")),
        ("colour", "Remote colour", "the colour of the remote", ("yellow", "various colours")),
    ], events=[
        ("a", "remote_type", "universal", 12, r"universal"),
        ("b", "speech", "excluded", 14, r"speech|voice|recogni"),
        ("b", "lcd", "excluded", 14, r"l[_ ]?c[_ ]?d|screen|display"),
        ("b", "teletext", "included", 17, r"teletext"),
        ("c", "battery", "rechargeable", 18, r"recharg|batter"),
        ("c", "case_material", "plastic", 19, r"plastic"),
        ("c", "colour", "yellow", 17, r"yellow"),
        ("d", "speech", "included", 14, r"yeah, speech recognition"),
        ("d", "case_material", "plastic", 12, r"plastic"),
        ("d", "colour", "various colours", 12, r"colou?r"),
    ], skip_changes=()),
    # ---------------------------------------------------------------- test (official AMI unseen set SC)
    "ES2004": dict(split="test", objects=[
        ("battery", "Battery type", "the battery type of the remote", ("rechargeable", "kinetic", "conventional")),
        ("video_plus", "Video Plus capability", "whether the remote has Video Plus", ("included", "excluded")),
        ("docking", "Docking station", "whether the remote comes with a docking station", ("included", "excluded")),
        ("lcd_colour", "LCD screen colours", "the colours of the LCD screen", ("black and white", "full colour")),
        ("speech", "Speech recognition", "whether the remote has speech recognition", ("included", "excluded")),
    ], events=[
        ("b", "battery", "rechargeable", 14, r"recharg|docking"),
        ("b", "video_plus", "included", 13, r"video plus"),
        ("b", "docking", "included", 14, r"docking"),
        ("c", "battery", "kinetic", 10, r"kinetic"),
        ("d", "lcd_colour", "black and white", 17, r"black and white|black-and-white"),
        ("d", "speech", "excluded", 15, r"speech|voice|recogni|budget"),
    ], skip_changes=("speech",)),
    "ES2014": dict(split="test", objects=[
        ("devices", "Devices the remote controls", "which devices the remote controls", ("television only", "multiple devices")),
        ("panel", "Panel hiding complicated functions", "whether the remote has a panel hiding the complicated functions", ("included", "excluded")),
        ("speech", "Speech recognition", "whether the remote has speech recognition", ("included", "excluded")),
        ("battery", "Power source", "the power source of the remote", ("kinetic", "battery")),
        ("chip", "Chip", "which chip the remote uses", ("simple chip", "advanced chip")),
        ("case_material", "Case material", "the material of the remote's case", ("rubber", "plastic")),
        ("case_curve", "Case curvature", "the curvature of the remote's case", ("single curved", "double curved")),
        ("buttons", "Button type", "which type of buttons the remote uses", ("push buttons", "scroll buttons")),
    ], events=[
        ("a", "devices", "television only", 11, r"televis|\btv\b"),
        ("b", "panel", "included", 17, r"panel|hid"),
        ("c", "speech", "included", 14, r"want it in as an extra"),
        ("c", "battery", "kinetic", 15, r"kinetic"),
        ("c", "chip", "simple chip", 16, r"chip|circuit|board"),
        ("c", "case_material", "rubber", 20, r"rubber"),
        ("c", "case_curve", "single curved", 20, r"single"),
        ("c", "buttons", "push buttons", 15, r"push"),
        ("d", "panel", "included", 16, r"slide-away"),
        ("d", "speech", "included", 19, r"speech|voice|recogni|sensor"),
        ("d", "battery", "kinetic", 20, r"kinetic"),
        ("d", "chip", "simple chip", 18, r"chip|circuit|board"),
        ("d", "case_material", "plastic", 12, r"plastic"),
        ("d", "case_curve", "single curved", 11, r"single"),
    ], skip_changes=()),
    "IS1009": dict(split="test", objects=[
        ("price", "Selling price (euro)", "the selling price of the remote, in euros", "number"),
        ("teletext", "Teletext feature", "whether the remote has teletext", ("included", "excluded")),
        ("power", "Power source", "the power source of the remote", ("batteries", "kinetic", "solar")),
        ("case_material", "Case material", "the material of the remote's case", ("plastic", "rubber", "wood")),
        ("button_material", "Button material", "the material of the remote's buttons", ("soft rubber", "hard plastic")),
        ("shape", "Remote shape", "the shape of the remote", ("snail shape", "standard shape")),
        ("led_colour", "LED colour", "the colour of the remote's light emitting diode", ("fluorescent green", "red", "blue")),
    ], events=[
        ("a", "price", 25, 14, r"twenty[- ]?five|\b25\b"),
        ("b", "teletext", "excluded", 11, r"teletext"),
        ("c", "power", "batteries", 16, r"batter"),
        ("d", "case_material", "plastic", 14, r"plastic"),
        ("d", "button_material", "soft rubber", 14, r"rubber"),
        ("d", "shape", "snail shape", 11, r"snail"),
        ("d", "led_colour", "fluorescent green", 17, r"green"),
    ], skip_changes=()),
    "TS3003": dict(split="test", objects=[
        ("price", "Selling price (euro)", "the selling price of the remote, in euros", "number"),
        ("max_cost", "Maximum production cost (euro)", "the maximum production cost of the remote, in euros", "number"),
        ("devices", "Devices the remote controls", "which devices the remote controls", ("multiple devices", "televisions only")),
        ("lcd", "LCD screen", "whether the remote has an LCD screen", ("included", "excluded")),
        ("docking", "Docking station", "whether the remote has a docking station", ("included", "excluded")),
        ("chip", "Chip", "which chip the remote uses", ("advanced chip", "simple chip")),
        ("case_material", "Case material", "the material of the remote's case", ("plastic", "rubber", "wood")),
        ("case_curve", "Case curvature", "the curvature of the remote's case", ("single curved", "double curved")),
    ], events=[
        ("a", "price", 25, 7, r"twenty[- ]?five|\b25\b"),
        ("a", "max_cost", 12.5, 9, r"twelve|12[. ]?5"),
        ("a", "devices", "multiple devices", 10, r"multiple|several|devices"),
        ("b", "lcd", "included", 15, r"l[_ ]?c[_ ]?d|screen|display"),
        ("b", "docking", "included", 13, r"docking"),
        ("c", "docking", "included", 9, r"docking"),
        ("c", "chip", "advanced chip", 11, r"advanced chip"),
        ("c", "case_curve", "single curved", 14, r"single"),
        ("d", "case_material", "plastic", 14, r"it's plastic"),
        ("d", "case_curve", "single curved", 14, r"single"),
        ("d", "lcd", "included", 19, r"l[_ ]?c[_ ]?d|screen|display"),
    ], skip_changes=()),
    "TS3007": dict(split="test", objects=[
        ("energy", "Energy source", "the energy source of the remote", ("batteries and kinetic", "battery only")),
        ("case_curve", "Case curvature", "the curvature of the remote's case", ("double curved", "single curved")),
        ("case_material", "Case material", "the material of the remote's case", ("rubber", "plastic")),
        ("touch_screen", "Touch screen", "whether the remote has a touch screen", ("included", "excluded")),
        ("speech", "Speech recognition", "whether the remote has speech recognition", ("included", "excluded")),
        ("games", "Games", "whether the remote includes games", ("included", "excluded")),
    ], events=[
        ("c", "energy", "batteries and kinetic", 16, r"kinetic"),
        ("c", "case_curve", "double curved", 17, r"double-curved and uh rubber"),
        ("c", "case_material", "rubber", 17, r"double-curved and uh rubber"),
        ("c", "touch_screen", "included", 18, r"one big touch screen"),
        ("c", "speech", "excluded", 20, r"speech|voice|recogni"),
        ("c", "games", "included", 19, r"game"),
        ("d", "energy", "battery only", 15, r"kinetic|batter"),
        ("d", "case_curve", "single curved", 14, r"single"),
    ], skip_changes=()),
}

ROLE_NAMES = {"PM": ("pm", "Project Manager"), "ID": ("id", "Industrial Designer"),
              "UI": ("ui", "User Interface Designer"), "ME": ("me", "Marketing Expert")}
# the four meetings of a series are placed on consecutive Mondays; AMI itself has no calendar dates
DATES = {"a": "2026-02-02", "b": "2026-02-09", "c": "2026-02-16", "d": "2026-02-23"}
NOW = "2026-03-02T00:00:00Z"
