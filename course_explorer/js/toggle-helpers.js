// =============================================================================
// TOGGLE-HELPERS.JS
//
// Small factories for the handful of toggle-function "shapes" that were
// previously copy-pasted ~40 times across search.js/media.js/standards.js
// (one flag/Set per feature, same 2-3 lines of body each time). Each factory
// below produces a `window.toggleX = ...` function; the modules that use them
// just supply which global flag/Set to touch and what should happen after.
//
// None of these change what any existing toggle function does — they're a
// mechanical de-duplication of identical bodies, not a behavior change.
// =============================================================================

/**
 * For a boolean flag toggled with no argument, e.g. onclick="toggleFoo()".
 * getFlag/setFlag are small closures over the specific `let` global being
 * toggled (globals declared with `let` at the top level aren't reachable as
 * object properties, so each call site still needs a one-line closure that
 * names its own global — see search.js for example usage).
 */
function makeFlagToggle(getFlag, setFlag, onChange) {
    return function() {
        setFlag(!getFlag());
        onChange();
    };
}

/**
 * For a boolean flag set to an explicit value from a checkbox, e.g.
 * onchange="toggleFoo(this.checked)".
 */
function makeCheckedFlagToggle(setFlag, onChange) {
    return function(checked) {
        setFlag(checked);
        onChange();
    };
}

/**
 * For toggling a key's membership in a Set, e.g. onclick="toggleFoo('01')".
 * Safe to close over `set` directly (unlike primitives, Set/Map globals in
 * this app are only ever mutated in place via .add()/.delete()/.clear(),
 * never reassigned to a new instance, so the reference stays valid).
 */
function makeSetToggle(set, onChange) {
    return function(key) {
        if (set.has(key)) set.delete(key);
        else               set.add(key);
        onChange();
    };
}

/**
 * For setting a key's membership in a Set to an explicit checked value,
 * e.g. onchange="toggleFoo('groupName', this.checked)".
 */
function makeSetMembershipToggle(set, onChange) {
    return function(key, isChecked) {
        if (isChecked) set.add(key);
        else            set.delete(key);
        onChange();
    };
}

/**
 * For "select all" / "clear all" controls over a Set, e.g.
 * onclick="toggleAllFoo(true)". `getAllItems` is called (lazily, only when
 * selecting all) to get the full list of keys to fill the set with.
 */
function makeSetAllToggle(set, getAllItems, onChange) {
    return function(selectAll) {
        set.clear();
        if (selectAll) getAllItems().forEach(item => set.add(item));
        onChange();
    };
}
