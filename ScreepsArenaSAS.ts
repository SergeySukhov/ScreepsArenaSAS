import { createConstructionSite, findClosestByPath, getCpuTime, getObjectsByPrototype, getTerrainAt, getTicks } from 'game/utils';
import { ConstructionSite, Creep, OwnedStructure, Source, Structure, StructureContainer, StructureExtension, StructureRampart, StructureSpawn } from 'game/prototypes';
import { MOVE, RANGED_ATTACK, TOUGH, ERR_NOT_IN_RANGE, ATTACK, HEAL, WORK, CARRY, RESOURCE_ENERGY, OK, TERRAIN_PLAIN } from 'game/constants';
import { CostMatrix } from 'game/path-finder';

// :\s{1}\(?[A-Z]+[a-zA-Z]+(\[\])*\s*(\|\s*[A-Z]+[A-Za-z]*\)?\s*(\[\])*)*

let allExtentedCreeps: ExtenedCreep[] = [];
let availableExtentedCreeps: ExtenedCreep[] = [];
let availbleExtentedHealthyCreeps: ExtenedCreep[] = [];
const matrix = new CostMatrix();

let myCreeps: Creep[] = [];

let rangedAttackCreeps: Creep[] = [];
let guardCreeps: Creep[] = [];
let healerCreeps: Creep[] = [];
let workerCreeps: Creep[] = [];
let carryCreeps: Creep[] = [];
let hunterCreeps: Creep[] = [];
let haulerCreeps: Creep[] = [];

let recoveryCreeps: ExtenedCreep[] = [];

let enemyCreeps: Creep[] = [];
let enemySourceCreeps: Creep[] = [];

let mySpawn: StructureSpawn;
let enemySpawn: StructureSpawn;

let rangerGroups: RangerGroup[] = [];
let hunterGroup: HunterGroup;
let resGroup: ResourceGroup;
let guardGroup: GuardGroup;

let attackSide = 1; // -1 | 1

let isNorthBlocked = false;
let isSouthBlocked = false;

let tick = 0;
let consoleTickCount = 0;
export function loop() {
    // TODO: опорные точки для отступления, крип для вражеской базы с измененой траекторией, 
    // ранние охотники на базу и к ресурсам
    // новый способ трансфера
    tick = getTicks();
    consoleTickCount = 0;

    getObjectsByPrototype(ConstructionSite).forEach(constructionSite => {
        matrix.set(constructionSite.x, constructionSite.y, 10); // avoid walking over a construction site
    });
    

    if (!mySpawn) mySpawn = getObjectsByPrototype(StructureSpawn).find(i => i.my);
   
    consoleCpu();
    enemyCreeps = getObjectsByPrototype(Creep).filter(creep => 
        !creep.my && creep.exists &&
         creep.body.some(x => x.type === ATTACK  && x.hits > 0 || x.hits > 0 && x.type === RANGED_ATTACK));
    enemySourceCreeps = getObjectsByPrototype(Creep).filter(creep =>
         !creep.my && creep.exists &&
          !creep.body.some(x => x.type === ATTACK && x.hits > 0 || x.hits > 0 && x.type === RANGED_ATTACK));
    if (!enemySpawn) enemySpawn = getObjectsByPrototype(StructureSpawn).filter(x => !x.my)[0];
    

    allExtentedCreeps = allExtentedCreeps.filter(creep => creep.creep?.exists);
    availableExtentedCreeps = allExtentedCreeps.filter(creep => !creep.creep.spawning);
    myCreeps = allExtentedCreeps.map(x => x.creep);

    const inj = recoveryCreeps.filter(x => x.creep?.exists && !isRecovered(x.creep));
    recoveryCreeps = allExtentedCreeps.filter(x => isNeedRecovery(x.creep));
    console.log("!! | loop | recoveryCreeps:", recoveryCreeps.length)
    recoveryCreeps.push(...inj.filter(x => !recoveryCreeps.find(xx => xx.creep.id === x.creep.id)));
    console.log("!! | loop | recoveryCreeps:", recoveryCreeps)
    availbleExtentedHealthyCreeps = allExtentedCreeps.filter(creep => !recoveryCreeps.find(xx => creep.creep.id === xx.creep.id));

    if (tick === 1) {
        resGroup = new ResourceGroup();
        guardGroup = new GuardGroup();
        hunterGroup = new HunterGroup();
        rangerGroups.push(new RangerGroup());
    }
    consoleCpu();


    // перенести набор в группу
    guardCreeps = [];
    hunterCreeps = [];
    workerCreeps = [];
    healerCreeps = [];
    carryCreeps= [];
    haulerCreeps= [];

    for (const extCreep of availbleExtentedHealthyCreeps) {

        if (extCreep.role === CreepRole.RANGER) rangedAttackCreeps.push(extCreep.creep);
        if (extCreep.role === CreepRole.GUARD) guardCreeps.push(extCreep.creep);
        if (extCreep.role === CreepRole.HUNTER) hunterCreeps.push(extCreep.creep);
        if (extCreep.role === CreepRole.WORKER) workerCreeps.push(extCreep.creep);
        if (extCreep.role === CreepRole.HEALER) healerCreeps.push(extCreep.creep);
        if (extCreep.role === CreepRole.CARRY) carryCreeps.push(extCreep.creep);
        if (extCreep.role === CreepRole.MEGAHAULER) haulerCreeps.push(extCreep.creep);
    }

    checkSide();
    checkPathFromBaseBlocked();

    backToHeal();
    consoleCpu();

    spwn(mySpawn);
    consoleCpu();

    hunterGroup.groupTick();
    consoleCpu();

    guardGroup.groupTick();
    consoleCpu();

    handleRangerGroup();
    consoleCpu();

    resGroup.groupTick();
    consoleCpu();


    
    consoleCpu();
}

export function handleRangerGroup() {
    if (!rangerGroups.length) return;

    for(const group of rangerGroups) {
        group.groupTick();
    }
   
    if (
        rangerGroups.length < 4 &&
        !rangerGroups.filter(x => x.groupState === GroupState.INIT).length &&
        availbleExtentedHealthyCreeps.length &&
        availbleExtentedHealthyCreeps.find(x => x.role === CreepRole.RANGER && !rangerGroups.some(xx => xx.isCreepInGroup(x.creep.id)))
        ) {
        rangerGroups.push(new RangerGroup());
    }
}

export function consoleCpu() {
    consoleTickCount++;

    // console.log("getCpuTime " + consoleTickCount,  Math.round(getCpuTime() / 1000000));
}
export function checkSide() {

    if (!enemyCreeps.length) return;
    const enemy = mySpawn.findClosestByRange(enemyCreeps)
    const range = enemy.getRangeTo(mySpawn);
    if (range < 15) {
        attackSide = enemy.y >= mySpawn.y ? 1 : -1;
    }
}

export function checkPathFromBaseBlocked() {
    isNorthBlocked = false;
    isSouthBlocked = false;
    if (!enemyCreeps.length) return;
    const closestEnemy = mySpawn.findClosestByRange(enemyCreeps);
    for(let y = 6; y < 20; y++) {
        if (isNorthBlocked && isNorthBlocked) break;
        let range = closestEnemy.getRangeTo({x: mySpawn.x, y: mySpawn.y + y });
        if (range < 7) {
            isNorthBlocked = true;
        }
        range = closestEnemy.getRangeTo({x: mySpawn.x, y: mySpawn.y - y });
        if (range < 7) {
            isSouthBlocked = true;
        }
    }

    if (isNorthBlocked || isSouthBlocked)
    for(let x = -8; x < 10; x++) {
        if (isNorthBlocked) {
            matrix.set(mySpawn.x + x, mySpawn.y + 30, 10);
        } else {
            matrix.set(mySpawn.x + x, mySpawn.y + 30, 0);
        }
        if (isSouthBlocked) {
            matrix.set(mySpawn.x + x, mySpawn.y - 30, 10);
        } else {
            matrix.set(mySpawn.x + x, mySpawn.y - 30, 0);
        }
    } 
}



export function isNeedRecovery(creep: Creep) {
    if (!creep?.exists) return false;
    return !creep.body.find(x => x.type !== MOVE && x.hits > 0);
}

export function isRecovered(creep: Creep) {
    return (creep.hits > creep.hits - 100) && (creep.hits > creep.hitsMax / 2 + 50);
}

export function handleHealer() {
    const allyCreeps = [...rangedAttackCreeps, ...healerCreeps];
    for(let healerCreep of healerCreeps) {
        let creepsToHeal = allyCreeps.filter(creep => creep.hits < creep.hitsMax);
        let closestInjAlly = healerCreep.findClosestByRange(creepsToHeal);
        if (fallBack(healerCreep, 4)) {
            healIfCan(healerCreep);
            continue;
        } 
        if (closestInjAlly) {
            if (healerCreep.heal(closestInjAlly) !== OK) {
                healerCreep.moveTo(closestInjAlly);
            }
        } else {
            let closestAlly = healerCreep.findClosestByRange(rangedAttackCreeps);
            healerCreep.moveTo(closestAlly);
        }
        healIfCan(healerCreep);
    }
}

export function spwn(mySpawn: StructureSpawn) {
    if (!mySpawn.spawning) {
        let creep: Creep;

        // WORKER
        if (carryCreeps.length > 1 && workerCreeps.length < 2 && tick < 1000) {
            creep = mySpawn.spawnCreep([
                WORK,
                WORK,
                CARRY,
                CARRY,
                MOVE, MOVE,
                MOVE, MOVE, 
                MOVE, MOVE, 
            ]).object;
            if (creep) {
                allExtentedCreeps.push({
                    creep: creep,
                    role:CreepRole.WORKER,
                });
            }
            return;
        } 

         // MEGAHAULER
         if (carryCreeps.length > 1 && haulerCreeps.length < 2 && tick < 800) {
            creep = mySpawn.spawnCreep([
                CARRY, CARRY,
                CARRY, CARRY,
                CARRY, CARRY,
                CARRY, CARRY,
                CARRY, CARRY,
                MOVE, MOVE,
                MOVE, MOVE,
                MOVE, MOVE,
                MOVE, MOVE, 
                MOVE, MOVE, 
            ]).object;
            if (creep) {
                allExtentedCreeps.push({
                    creep: creep,
                    role:CreepRole.MEGAHAULER,
                });
            }
            return;
        } 

        // CARRY
        if (carryCreeps.length < 3 && tick < 1200) {
            creep = mySpawn.spawnCreep([
                CARRY, 
                MOVE,
                MOVE,
            ]).object;
            if (creep) {
                allExtentedCreeps.push({
                    creep: creep,
                    role:CreepRole.CARRY,
                });
            }
            return;
        } 

        
        // HUNTER
        if (hunterCreeps.length < 2) {
            creep = mySpawn.spawnCreep([
                ATTACK, ATTACK,
                MOVE, MOVE,
                MOVE, MOVE,
                MOVE, 
            ]).object;
            if (creep) {
                allExtentedCreeps.push({
                    creep: creep,
                    role:CreepRole.HUNTER,
                });
            }
            return;
        } 

        // GUARD
        if (guardCreeps.length < 3) {
            creep = mySpawn.spawnCreep([
                MOVE,
                RANGED_ATTACK,
                RANGED_ATTACK,
                RANGED_ATTACK,
                RANGED_ATTACK,
                HEAL,
            ]).object;
            if (creep) {
                allExtentedCreeps.push({
                    creep: creep,
                    role:CreepRole.GUARD,
                });
            }
            return;
        }
        // HEAL
        // if (rangedAttackCreeps.length > 2 && healerCreeps.length < 2) {
        //     creep = mySpawn.spawnCreep([
        //         HEAL, HEAL,
        //         MOVE, MOVE
        //     ]).object;
        //     if (creep) {
        //         allExtentedCreeps.push({
        //             creep: creep,
        //             role:CreepRole.HEALER,
        //         });
        //     }
        //     return;
        // }

        // RANGED
        if (guardCreeps.length > 2) {

            creep = mySpawn.spawnCreep([
                RANGED_ATTACK, 
                RANGED_ATTACK,
                RANGED_ATTACK,
                MOVE, MOVE,
                MOVE, MOVE,
                MOVE, MOVE,
            ]).object;
            if (creep) {
                allExtentedCreeps.push({
                    creep: creep,
                    role:CreepRole.RANGER,
                });
            }
        }

    }
}

export function backToHeal() {
    if (!recoveryCreeps.length) return;
    for(let extCreep of recoveryCreeps) {
        const creep = extCreep.creep;
        if (creep.getRangeTo(mySpawn) > 1) {
            if(creep.moveTo({x: mySpawn.x, y: mySpawn.y - attackSide}) !== OK) {
                creep.moveTo({x: mySpawn.x - 1, y: mySpawn.y - attackSide})
            }
        }
        attackIfCan(creep);
        healIfCan(creep);
    }
}

export function fallBack(creep: Creep, range = 2) {
    let wasRetreat = false;
    if (!enemyCreeps.length) return;
    const closestEns = creep.findClosestByRange(enemyCreeps);
    if (closestEns) {
        if (creep.getRangeTo(closestEns) <= range) {
            wasRetreat = true;
            if(creep.moveTo({x: mySpawn.x, y: mySpawn.y - attackSide * range - attackSide}) !== OK) {
                creep.moveTo({x: mySpawn.x - 1, y: mySpawn.y - attackSide})
            }
        }
    }
    return wasRetreat;
}

export function healIfCan(creep: Creep) {
    if (!creep?.exists || !creep.body.length) return;
    if (creep.body.some(xx => xx.type === HEAL) && myCreeps.length) {
        if (creep.hits < creep.hitsMax) {
            creep.heal(creep);
        } else {
            const closestAlly = creep.findClosestByRange(myCreeps.filter(x => x.hits < x.hitsMax));
            if (closestAlly) {
                if (creep.heal(closestAlly) !== OK) {
                    creep.rangedHeal(closestAlly);
                }
            }
        }
    }
}

export function attackIfCan(creep: Creep) {
    if (!creep?.exists || !creep.body.length) return;
    if (creep.body.some(xx => xx.type === RANGED_ATTACK) && enemyCreeps.length > 0) {
        let closestEnemyCreep = creep.findClosestByRange(enemyCreeps);
        
        if (creep.getRangeTo(closestEnemyCreep) < 4 && creep.rangedAttack(closestEnemyCreep) === OK)
            return true;
    }
    if (creep.body.some(xx => xx.type === RANGED_ATTACK) && enemySourceCreeps.length > 0) {
        let closestEnemyCreep = creep.findClosestByRange([...enemySourceCreeps, enemySpawn]);
        if (creep.getRangeTo(closestEnemyCreep) < 4 && creep.rangedAttack(closestEnemyCreep) === OK)
            return true;
    }
    if (creep.body.some(xx => xx.type === ATTACK) && enemyCreeps.length > 0) {
        let closestEnemyCreep = creep.findClosestByRange(enemyCreeps);
        if (creep.getRangeTo(closestEnemyCreep) < 2 && creep.attack(closestEnemyCreep) === OK)
            return true;
    }
    if (creep.body.some(xx => xx.type === ATTACK) && enemySourceCreeps.length > 0) {
        let closestEnemyCreep = creep.findClosestByRange([...enemySourceCreeps, enemySpawn]);
        if (creep.getRangeTo(closestEnemyCreep) < 2 && creep.attack(closestEnemyCreep) === OK)
            return true;
    }
    return false;
}

export class HunterGroup {

    huntersAim: Structure | Creep | StructureContainer;

    hunters: Creep[] = [];

    constructor() {
        this.init();
    }

    init() {

    }

    groupTick() {
        if (availbleExtentedHealthyCreeps.length > 0) {
            const newCreep = availbleExtentedHealthyCreeps.find(x => x.role === CreepRole.HUNTER && !this.hunters.find(xx => xx.id === x.creep.id));
            if (newCreep) {
                this.hunters.push(newCreep.creep);
            }
        }
        
        this.hunters = this.hunters.filter(x => !isNeedRecovery(x));

        if (!this.hunters?.length) return;
        
        this.findHunterAim();

        for(const hunter of this.hunters) {
            if (fallBack(hunter, 5)) continue;
            this.handleCreep(hunter);
        }
    }
   
    handleCreep(hCreep: Creep) {
        attackIfCan(hCreep);
        if (fallBack(hCreep, 6)) {
            return;
        } 
        if (hCreep.attack(this.huntersAim) !== OK) {
            hCreep.moveTo(this.huntersAim);
        }
    }

    findHunterAim() {
        if (!this.hunters.length) return;
        if (!this.huntersAim?.exists) this.huntersAim = undefined;
        if (enemyCreeps.length && this.huntersAim?.exists && this.huntersAim.findClosestByRange(enemyCreeps).getRangeTo(this.huntersAim) < 4) {
            this.huntersAim = undefined;
        }
        if (!enemyCreeps.length || enemyCreeps.length && enemySpawn.findClosestByRange(enemyCreeps).getRangeTo(enemySpawn) > 5) {
            this.huntersAim = enemySpawn;
            return;
        } 
        if (!this.huntersAim && enemySourceCreeps.length && enemyCreeps.length) {
            const aims = enemySourceCreeps.filter(sourceCreep => sourceCreep.findClosestByRange(enemyCreeps).getRangeTo(sourceCreep))
            if (aims?.length) {
                this.huntersAim = hunterCreeps[0].findClosestByRange(aims);
                return;
            }
        }

        if (!this.huntersAim) {
            const conteiner = getObjectsByPrototype(StructureContainer)?.filter(x => x.getRangeTo(enemySpawn) > 6);
            if (conteiner.length) {
                this.huntersAim = enemySpawn.findClosestByPath(conteiner);
            }
        }
    }
    

}

export class GuardGroup {
    guards: Creep[] = [];

    constructor() {
        this.init();
    }

    init() {

    }

    groupTick() {
        if (tick <= 1) return;
        if (availbleExtentedHealthyCreeps.length > 0) {
            const newCreep = availbleExtentedHealthyCreeps.find(x => x.role === CreepRole.GUARD && !this.guards.find(xx => xx.id === x.creep.id));
            if (newCreep) {
                this.guards.push(newCreep.creep);
            }
        }
        let i = -1; // предполагается не больше 3 стражей
        for(const guard of this.guards) {
            this.handleGuard(guard, i);
            i++;
        }
    }

    handleGuard(creep: Creep, guardNum) {
        const newPos = { x: mySpawn.x + guardNum, y: mySpawn.y + attackSide };
        creep.moveTo(newPos);      

        if(!attackIfCan(creep)) {
            healIfCan(creep);
        }
        
    }

    
}

export class ResourceGroup {
    carries: Creep[] = [];

    workers: Creep[] = [];
    
    haulers: Creep[] = [];

    homeStores: StructureContainer[] = [];
    closestStoreWithResourse: StructureContainer;
    closestTargetStore: StructureExtension | StructureExtension;

    rampartSites: ConstructionSite[] = [];
    extensionSites: ConstructionSite[] = [];

    closestSite: ConstructionSite;

    constructor() {
        this.init();
    }

    // 1 call only
    init() {
        this.setHomeStores();
        this.locateRampartSites();
    }
 
    groupTick() {
        if (tick <= 1) return;
        if (this.rampartSites.length) this.rampartSites = this.rampartSites.filter(x => x.exists && x.progress < x.progressTotal);
        if (this.extensionSites.length) this.extensionSites = this.extensionSites.filter(x => x.exists && x.progress < x.progressTotal);
        
        this.carries = this.carries.filter(x => x?.exists && !isNeedRecovery(x));
        this.workers = this.workers.filter(x => x?.exists && !isNeedRecovery(x));
        this.haulers = this.haulers.filter(x => x?.exists && !isNeedRecovery(x));

        if (!this.rampartSites.length) {
            let store = getObjectsByPrototype(StructureContainer).filter(s => s.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && s.getRangeTo(mySpawn) > 6)
            const newNotHomeSource = mySpawn.findClosestByRange(store);
            this.locateExtensionAroundResource(newNotHomeSource);
        }

        if (!this.closestStoreWithResourse?.exists || this.closestStoreWithResourse.store?.getUsedCapacity() < 10) {
            this.closestStoreWithResourse = this.setNewResource();
        }

        if (availbleExtentedHealthyCreeps.length > 0) {
            const newCreep = availbleExtentedHealthyCreeps.find(x => x.role === CreepRole.WORKER && !this.workers.find(xx => xx.id === x.creep.id));
            if (newCreep) {
                this.workers.push(newCreep.creep);
            }
        }

        if (availbleExtentedHealthyCreeps.length > 0) {
            const newCreep = availbleExtentedHealthyCreeps.find(x => x.role === CreepRole.CARRY && !this.carries.find(xx => xx.id === x.creep.id));
            if (newCreep) {
                this.carries.push(newCreep.creep);
            }
        }

        if (availbleExtentedHealthyCreeps.length > 0) {
            const newCreep = availbleExtentedHealthyCreeps.find(x => x.role === CreepRole.MEGAHAULER && !this.haulers.find(xx => xx.id === x.creep.id));
            if (newCreep) {
                this.haulers.push(newCreep.creep);
            }
        }

        if (workerCreeps.length) {
            if (this.extensionSites.length) {
                this.closestSite = workerCreeps[0].findClosestByRange(this.extensionSites);
            } else if (this.rampartSites.length) {
                this.closestSite = mySpawn.findClosestByPath(this.rampartSites)
            } else {
                this.closestSite = undefined;
            }
        }

        for(const creep of this.carries) {
            if (fallBack(creep, 6)) continue;
            this.handleCarry(creep)
        }

        this.setNewTargetSource();
        
        for(const creep of this.workers) {
            if (fallBack(creep, 6)) continue;
            if (this.closestSite && tick < 1500) {
                this.handleWorker(creep);
            } else {
                this.handleCarry(creep)
            }
        }

        for(const creep of this.haulers) {
            if (fallBack(creep, 6)) {

            } else {
                this.handleHaulers(creep);
            }
        }
    }

    setHomeStores() {
        this.homeStores.push(...getObjectsByPrototype(StructureContainer).filter(s => s.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && s.getRangeTo(mySpawn) < 5));
    }

    locateRampartSites() {
        for(let dx = -1; dx < 2; dx++)
            for(let dy = -1; dy < 2; dy++) {
                const pos = {x: mySpawn.x + dx, y: mySpawn.y + dy };
                const res = createConstructionSite(pos, StructureRampart);
                if (res.object) this.rampartSites.push(res.object);
            }
    }

    setNewResource() {
        let store = this.homeStores.filter(s => s.store.getUsedCapacity(RESOURCE_ENERGY) > 0)
        if (store.length) {
            this.closestTargetStore = mySpawn;
            return store[0];
        }
        // path enemy location
        let source = getObjectsByPrototype(StructureContainer).filter(s => s.exists && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        const newNotHomeSource = (this.closestStoreWithResourse ?? mySpawn)?.findClosestByPath(source);
        return newNotHomeSource;
    }

    setNewTargetSource() {
        let myExt = getObjectsByPrototype(StructureExtension).filter(s => s.my && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        if (this.closestStoreWithResourse && myExt?.length) {
            this.closestTargetStore =  this.closestStoreWithResourse.findClosestByPath(myExt);
        } else {
            this.closestTargetStore = mySpawn;
        }
    }

    locateExtensionAroundResource(source: StructureContainer) {
        let isOk = false;
        if (!source?.exists || getObjectsByPrototype(StructureExtension).filter(x => x.my).length > 4 || this.extensionSites.length > 8) {
            return false;
        }
        for(let x = 0; x <= 1; x++) 
            for(let y = -1; y <= 1; y++) {
                const pos = {x: source.x + x, y: source.y - y };
                const site = getObjectsByPrototype(ConstructionSite).find(x => x.x === pos.x && x.y === pos.y);
                if (site) continue;
                const result = createConstructionSite(pos, StructureExtension);
                if (result.object) {
                    isOk = true;
                    this.extensionSites.push(result.object);
                }
            }
        return isOk;
    }

    handleWorker(creep: Creep) {
        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) < 10) {
            const closestStoreWithResourse = this.getClosestSource(creep);
            if(closestStoreWithResourse && creep.withdraw(closestStoreWithResourse, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(closestStoreWithResourse);
            }
            return;
        }

        if (this.rampartSites.length > 0) {
            
            if (creep.build(this.closestSite) === ERR_NOT_IN_RANGE) {
                creep.moveTo(this.closestSite);
            }
            this.moveFromPosition(creep, this.closestSite);
            return;
        }

        if (this.extensionSites.length > 0) {
            if (creep.build(this.closestSite) === ERR_NOT_IN_RANGE) {
                creep.moveTo(this.closestSite);
            }
            this.moveFromPosition(creep, this.closestSite);
            return;
        }


    }
    
    handleCarry(creep: Creep) {
         if(creep.store.getUsedCapacity(RESOURCE_ENERGY) < 10) {
            const closestStoreWithResourse = this.getClosestSource(creep);
            if(closestStoreWithResourse && creep.withdraw(closestStoreWithResourse, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(closestStoreWithResourse);
            }
        } else {
            const allSources = getObjectsByPrototype(StructureExtension)
            .filter(s => s.exists && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    
            const closestTarget = creep.findClosestByPath([...allSources, mySpawn]);
            if(creep.transfer(closestTarget, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(closestTarget);
            }
        }
    }

    handleHaulers(creep: Creep) {
        if(creep.store.getUsedCapacity(RESOURCE_ENERGY) < 10) {
            let allSources = getObjectsByPrototype(StructureContainer);
            
            allSources = allSources.filter(s => s?.exists && s.getRangeTo(mySpawn) > 6 && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
    
            if (enemyCreeps?.length) {
                allSources = allSources.filter(x => x.findClosestByRange(enemyCreeps).getRangeTo(x) > 8);
            }
            if (!allSources.length) {
                return;
            }
            const closestStoreWithResourse = creep.findClosestByPath(allSources);

            if(closestStoreWithResourse && creep.withdraw(closestStoreWithResourse, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(closestStoreWithResourse);
            }
            
        } else {
            if(creep.transfer(mySpawn, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(mySpawn);
            }
        }
    }

    getClosestSource(creep: Creep) {
        let allSources = getObjectsByPrototype(StructureContainer);
        if (this.haulers?.length && !this.haulers.find(x => x.id === creep.id)) {
            allSources.push(...this.haulers)
        }
        allSources = allSources.filter(s => s?.exists && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0);

        if (enemyCreeps?.length) {
            allSources = allSources.filter(x => x.findClosestByRange(enemyCreeps).getRangeTo(x) > 8);
        }
        if (allSources.length) {
            return creep.findClosestByPath(allSources);
        } else {
            return undefined;
        }
    }

    moveFromPosition(creep: Creep, pos) {
        if (!pos || !creep){
            return;
        }
        if (creep.x === pos.x && creep.y === pos.y) {
            creep.moveTo(mySpawn);
        }
    }
}

export class RangerGroup {
    leader: Creep;
    leaderTarget: Creep | Structure;
    rangers: Creep[] = [];
    healers: Creep[] = [];
    rangerGroupSize = 5;
    healerGroupSize = 0;
    rangeForWaiting = 6;
    groupState = GroupState.INIT;

    groupTick() {
        // console.log("!! | leader:", this.leader?.id)
        // console.log("!! | groupState:", this.groupState)
        // console.log("!! | rangers:", this.rangers.length)
        this.rangers = this.rangers.filter(x => !isNeedRecovery(x));

        if (isNeedRecovery(this.leader)) {
            this.leader = this.rangers.length ? this.rangers[0] : undefined;
        }
        this.handleLeader();


        for(const creep of this.rangers) {
            const fallBackRange = getTerrainAt({x: creep.x, y: creep.y}) === TERRAIN_PLAIN ? 2 : 3;
    
            if (fallBack(creep, fallBackRange)) {
                attackIfCan(creep);
                continue;
            }
            
            this.handleRanger(creep);
        }
       

        
        
        // for(const creep of this.healers) {
        //     const fallBackRange = getTerrainAt({x: creep.x, y: creep.y}) === TERRAIN_PLAIN ? 2 : 3;
    
        //     if (fallBack(creep, fallBackRange)) {
        //         attackIfCan(creep);
        //         continue;
        //     }
        //     this.handleHealer(creep);
        // }
        // recoveryCreeps.push(...this.injured.map(inj => {
        //     return {
        //          creep: inj, role:CreepRole.RANGER };
        //     }));
        // this.healers = this.healers.filter(x => !this.injured.find(xx => xx.id === x.id));
        // 

        this.handleGroupState();
    }
    
    isCreepInGroup(id) {
        return [...this.rangers, ...this.healers].some(creep => creep.id === id);
    }

    handleGroupState() {
        if (this.groupState === GroupState.INIT) {
            if (availbleExtentedHealthyCreeps.length > 0) {
                const newCreep = availbleExtentedHealthyCreeps.find(
                    x => x.role === CreepRole.RANGER &&
                        x.creep.getRangeTo(mySpawn) < 5 &&
                        !rangerGroups.some(xx => xx.isCreepInGroup(x.creep.id))
                    );
                if (newCreep) {
                    if (!this.leader?.exists) {
                        this.leader = newCreep.creep;
                    }
                    this.rangers.push(newCreep.creep);
                }
            }
            if (this.rangers.length  >= this.rangerGroupSize && this.leader?.exists) {
                this.groupState = GroupState.ATTACK;
            }
            return;
        } 
        if (this.groupState === GroupState.ATTACK) {
            if (this.rangers.length < this.rangerGroupSize / 2) this.groupState = GroupState.RETREAT;
            return;
        }
        if (this.groupState === GroupState.RETREAT) {
            if (!this.rangers.length) {
                this.groupState = GroupState.INIT;
            }
            if(!this.rangers.find(x => x.getRangeTo(mySpawn) > 5)) {
                this.groupState = GroupState.INIT;
            }
            return;
        }
        
    }


    handleLeader() {
        if (!this.leader?.exists) {
            return;
        }
        if (fallBack(this.leader, 3)) {
            attackIfCan(this.leader)
            return;
        }
        attackIfCan(this.leader)
        if (this.groupState === GroupState.INIT) {
            return;
        }
        if (this.groupState === GroupState.ATTACK) {
          this.leader.moveTo(enemySpawn)
        }
        if (this.groupState === GroupState.WAITING) {
           if (this.leader && this.rangers.length && !this.rangers.find(x => x.getRangeTo(this.leader) > this.rangeForWaiting)) {
                this.groupState = GroupState.ATTACK;
           }
        }
        if (this.groupState === GroupState.RETREAT) {
          this.leader.moveTo(mySpawn);
        }
       

    }

    handleRanger(creep: Creep) {
        if (this.groupState === GroupState.INIT) {
            if (mySpawn.x < 10) {
                creep.moveTo({x: mySpawn.x + 5, y: mySpawn.y})
            } else {
                creep.moveTo({x: mySpawn.x - 5, y: mySpawn.y})
            }
        }
        if (this.groupState === GroupState.ATTACK) {
            if (creep.id === this.leader.id) return;
 
            attackIfCan(creep);

            if (this.leader?.exists) {
                creep.moveTo(this.leader);
                if (creep.getRangeTo(this.leader) > this.rangeForWaiting) {
                    this.groupState = GroupState.WAITING;
                }
            } 
        }
        if (this.groupState === GroupState.WAITING) {
            attackIfCan(creep);

            if (this.leader?.exists) {
                creep.moveTo(this.leader);
            } else {

            }
        }
        if (this.groupState === GroupState.RETREAT) {
            attackIfCan(creep);
            creep.moveTo(mySpawn);
        }
       

    }

    handleHealer(creep: Creep) {
        if (this.groupState === GroupState.INIT) {
   
        }
        if (this.groupState === GroupState.ATTACK) {
        
        }
        if (this.groupState === GroupState.WAITING) {
         
        }
        if (this.groupState === GroupState.RETREAT) {
            
        }
       

    }
}

export class GroupState {
    static INIT = 1;
    static ATTACK = 2;
    static WAITING = 3;
    static RETREAT = 4;

}

export class ExtenedCreep {
    creep: Creep;
    role: Number;
}

export class CreepRole {
    static RANGER = 1;
    static WORKER = 2;
    static GUARD = 3;
    static HEALER = 4;
    static HUNTER = 5;
    static CARRY = 6;
    static MEGAHAULER = 7;
}
