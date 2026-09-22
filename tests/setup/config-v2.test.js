"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig, validateWorkspace, CORE_FEATURES } = require("../../src/runtime/config.js");
const config = () => ({version:2,project:{name:"Work",root:"."},workspaces:["work"],tracking:{contracts:"untracked"},guards:{enabled:true,critical_actions:["delete","destructive_overwrite","send","publish","deploy","payment","permission_change","external_mutation"]},features:["setup","ready","go","index","doctor"],extensions:{},documents:[]});
test("v2 accepts five skills and scoped document navigation without Git", () => {
 assert.ok(CORE_FEATURES.includes("index"));
 assert.equal(validateConfig(config()).valid,true);
 const c=config(); c.documents=[{path:"docs/team.md",purpose:"Team rules",scope:"work",depends:[]}];
 assert.equal(validateConfig(c).valid,true);
 c.documents[0].path="../outside.md";
 assert.equal(validateConfig(c).valid,false);
});
test("workspace roles accept Korean paths and reject conflicting or unsafe rules", () => {
 const w={version:2,id:"work",name:"회사 업무",path:"회사 업무",purpose:"Reports",folders:[{path:"회의록",purpose:"Minutes"}],rules:[{id:"minutes-name",kind:"name",path:"회의록",value:"^[a-z].*\\.md$"}],exclude:[],context:[],protect:[]};
 assert.equal(validateWorkspace(w).valid,true);
 assert.equal(validateWorkspace({...w,path:"../escape"}).valid,false);
 assert.equal(validateWorkspace({...w,folders:[{path:"../escape",purpose:"No"}]}).valid,false);
 assert.equal(validateWorkspace({...w,rules:[{id:"x",kind:"unknown",path:".",value:"x"}]}).valid,false);
 assert.equal(validateWorkspace({...w,rules:[{id:"x",kind:"name",path:".",value:"["}]}).valid,false);
});
