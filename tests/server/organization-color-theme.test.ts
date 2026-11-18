import {test} from "node:test";
import assert from "node:assert/strict";
import {authorizeColorTheme,colorTheme,organizationColorThemes} from "../../server/modules/administration/color-theme.js";
test('organization palette is restricted to the owner and old clients preserve the current value',()=>{
 assert.equal(colorTheme(undefined),'mare');
 for(const choice of organizationColorThemes) assert.equal(authorizeColorTheme({colorTheme:choice},{colorTheme:'mare'},true),choice);
 assert.equal(authorizeColorTheme({color:'#147d92'},{colorTheme:'argila'},false),'argila');
 assert.equal(authorizeColorTheme({colorTheme:'cobalto'},{colorTheme:'cobalto'},false),'cobalto');
 assert.throws(()=>authorizeColorTheme({colorTheme:'grafite'},{colorTheme:'mare'},false),/ORGANIZATION_OWNER_REQUIRED/);
 assert.throws(()=>authorizeColorTheme({colorTheme:'arbitrary-css'},{colorTheme:'mare'},true),/INVALID_COLOR_THEME/);
});
